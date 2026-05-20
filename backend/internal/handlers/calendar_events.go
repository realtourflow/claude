package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	"realtourflow/internal/calendar"
)

// dealEventUID returns the stable internal UID we use to identify the
// "closing day" calendar event for a given deal. Must match what the iCal
// feed produces so we don't double-create events for the same deal.
func dealEventUID(dealID string) string { return fmt.Sprintf("close-%s", dealID) }

// taskEventUID is the stable UID for a task's due-date calendar event.
func taskEventUID(taskID string) string { return fmt.Sprintf("task-%s", taskID) }

// pushers returns the configured calendar Pushers for FanOut calls.
func (h *Handler) pushers() []calendar.Pusher {
	var out []calendar.Pusher
	if h.googlePusher != nil {
		out = append(out, h.googlePusher)
	}
	if h.microsoftPusher != nil {
		out = append(out, h.microsoftPusher)
	}
	return out
}

// pushDealClosingEvent upserts the "Closing — <title>" event in every
// calendar the agent has connected. Best-effort: errors are logged but
// the calling handler doesn't surface them to the user.
//
// Idempotent — calling this with the same dealID multiple times patches
// the same external event each time (we store the mapping in
// calendar_event_map).
func (h *Handler) pushDealClosingEvent(ctx context.Context, dealID string) {
	pushers := h.pushers()
	if len(pushers) == 0 {
		return
	}

	var (
		agentID, title string
		address        sql.NullString
		closing        sql.NullString
	)
	err := h.db.QueryRowContext(ctx, `
		SELECT d.agent_id, d.title, d.address,
		       COALESCE(
		         d.arive_key_dates->>'estimatedFundingDate',
		         d.arive_key_dates->>'closingContingency'
		       )
		FROM deals d
		WHERE d.id = $1
	`, dealID).Scan(&agentID, &title, &address, &closing)
	if err != nil {
		log.Printf("pushDealClosingEvent: load deal %s: %v", dealID, err)
		return
	}
	if !closing.Valid || closing.String == "" {
		// No closing date known — delete the event if one previously existed,
		// since the agent may have cleared the date.
		calendar.FanOutDelete(ctx, h.db, agentID, dealEventUID(dealID), pushers...)
		return
	}
	// Closing date may come as "2026-09-15" or full RFC3339; accept either.
	day, err := parseDate(closing.String)
	if err != nil {
		log.Printf("pushDealClosingEvent: bad closing date %q for deal %s: %v", closing.String, dealID, err)
		return
	}

	loc := ""
	if address.Valid {
		loc = address.String
	}
	ev := calendar.Event{
		InternalUID: dealEventUID(dealID),
		Summary:     fmt.Sprintf("Closing — %s", title),
		Description: fmt.Sprintf("RealTourFlow closing day for %s", title),
		Location:    loc,
		Start:       day,
		End:         day.Add(24 * time.Hour),
		AllDay:      true,
	}
	calendar.FanOut(ctx, h.db, agentID, ev, pushers...)
}

// pushTaskDueEvent upserts a calendar event for a task's due date.
func (h *Handler) pushTaskDueEvent(ctx context.Context, taskID string) {
	pushers := h.pushers()
	if len(pushers) == 0 {
		return
	}

	var (
		dealAgentID, taskTitle, dealTitle string
		due                               sql.NullString
		status                            string
	)
	err := h.db.QueryRowContext(ctx, `
		SELECT d.agent_id, t.title, d.title, t.due_date::TEXT, t.status
		FROM tasks t JOIN deals d ON d.id = t.deal_id
		WHERE t.id = $1
	`, taskID).Scan(&dealAgentID, &taskTitle, &dealTitle, &due, &status)
	if err != nil {
		log.Printf("pushTaskDueEvent: load task %s: %v", taskID, err)
		return
	}
	// Completed/skipped/no-due tasks should not have a calendar entry.
	if !due.Valid || due.String == "" || status == "completed" || status == "skipped" {
		calendar.FanOutDelete(ctx, h.db, dealAgentID, taskEventUID(taskID), pushers...)
		return
	}
	day, err := parseDate(due.String)
	if err != nil {
		log.Printf("pushTaskDueEvent: bad due date %q for task %s: %v", due.String, taskID, err)
		return
	}
	ev := calendar.Event{
		InternalUID: taskEventUID(taskID),
		Summary:     fmt.Sprintf("%s — %s", taskTitle, dealTitle),
		Description: "RealTourFlow task deadline",
		Start:       day,
		End:         day.Add(24 * time.Hour),
		AllDay:      true,
	}
	calendar.FanOut(ctx, h.db, dealAgentID, ev, pushers...)
}

// deleteDealCalendarEvent removes the closing-day event from connected calendars.
func (h *Handler) deleteDealCalendarEvent(ctx context.Context, agentID, dealID string) {
	pushers := h.pushers()
	if len(pushers) == 0 {
		return
	}
	calendar.FanOutDelete(ctx, h.db, agentID, dealEventUID(dealID), pushers...)
}

// deleteTaskCalendarEvent removes a task's due-date event from connected calendars.
func (h *Handler) deleteTaskCalendarEvent(ctx context.Context, agentID, taskID string) {
	pushers := h.pushers()
	if len(pushers) == 0 {
		return
	}
	calendar.FanOutDelete(ctx, h.db, agentID, taskEventUID(taskID), pushers...)
}

// parseDate accepts "YYYY-MM-DD" or full RFC3339 and returns midnight UTC of
// that day so we can use it as an all-day event start.
func parseDate(s string) (time.Time, error) {
	if len(s) >= 10 {
		if t, err := time.Parse("2006-01-02", s[:10]); err == nil {
			return t, nil
		}
	}
	return time.Parse(time.RFC3339, s)
}
