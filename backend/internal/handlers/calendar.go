package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"realtourflow/internal/middleware"
)

// GetCalendarURL returns the user's iCal subscription URL, generating a token if needed.
func (h *Handler) GetCalendarURL(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	userID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	var token string
	err = h.db.QueryRowContext(r.Context(),
		`SELECT calendar_token FROM users WHERE id = $1`, userID,
	).Scan(&token)
	if err != nil || token == "" {
		b := make([]byte, 24)
		rand.Read(b)
		token = hex.EncodeToString(b)
		h.db.ExecContext(r.Context(),
			`UPDATE users SET calendar_token = $1 WHERE id = $2`, token, userID,
		)
	}

	scheme := "https"
	if r.TLS == nil {
		scheme = "http"
	}
	feedURL := fmt.Sprintf("%s://%s/api/calendar/%s/feed.ics", scheme, r.Host, token)
	webcalURL := strings.Replace(feedURL, "https://", "webcal://", 1)
	webcalURL = strings.Replace(webcalURL, "http://", "webcal://", 1)

	respond(w, http.StatusOK, map[string]string{
		"feed_url":   feedURL,
		"webcal_url": webcalURL,
	})
}

// CalendarFeed returns the iCal feed for the given calendar token (public, no JWT).
func (h *Handler) CalendarFeed(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if token == "" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	var userID string
	err := h.db.QueryRowContext(r.Context(),
		`SELECT id FROM users WHERE calendar_token = $1`, token,
	).Scan(&userID)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	type calEvent struct {
		uid     string
		dtstart string
		summary string
		desc    string
	}

	var events []calEvent

	// Closing dates from deals
	rows, err := h.db.QueryContext(r.Context(), `
		SELECT d.id, d.title, d.address,
		       COALESCE(
		         d.arive_key_dates->>'estimatedFundingDate',
		         d.arive_key_dates->>'closingContingency'
		       ) AS closing_date
		FROM deals d
		WHERE d.agent_id = $1
		  AND (
		    d.arive_key_dates->>'estimatedFundingDate' IS NOT NULL
		    OR d.arive_key_dates->>'closingContingency' IS NOT NULL
		  )
		UNION
		SELECT d2.id, d2.title, d2.address,
		       COALESCE(
		         d2.arive_key_dates->>'estimatedFundingDate',
		         d2.arive_key_dates->>'closingContingency'
		       )
		FROM deals d2
		JOIN deal_participants dp ON dp.deal_id = d2.id AND dp.user_id = $1
		WHERE d2.arive_key_dates->>'estimatedFundingDate' IS NOT NULL
		   OR d2.arive_key_dates->>'closingContingency' IS NOT NULL
	`, userID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, title string
			var address, closingDate *string
			if rows.Scan(&id, &title, &address, &closingDate) == nil && closingDate != nil {
				date := strings.TrimSpace(*closingDate)
				if len(date) >= 10 {
					dateStr := strings.ReplaceAll(date[:10], "-", "")
					addr := ""
					if address != nil {
						addr = *address
					}
					events = append(events, calEvent{
						uid:     fmt.Sprintf("close-%s@realtourflow", id),
						dtstart: dateStr,
						summary: fmt.Sprintf("Closing — %s", title),
						desc:    addr,
					})
				}
			}
		}
	}

	// Task deadlines
	taskRows, err := h.db.QueryContext(r.Context(), `
		SELECT t.id, t.title, d.title, t.due_date::TEXT
		FROM tasks t
		JOIN deals d ON d.id = t.deal_id
		WHERE (d.agent_id = $1 OR EXISTS(SELECT 1 FROM deal_participants WHERE deal_id = d.id AND user_id = $1))
		  AND t.due_date IS NOT NULL
		  AND t.status != 'completed'
	`, userID)
	if err == nil {
		defer taskRows.Close()
		for taskRows.Next() {
			var id, title, dealTitle, dueDate string
			if taskRows.Scan(&id, &title, &dealTitle, &dueDate) == nil {
				if len(dueDate) >= 10 {
					dateStr := strings.ReplaceAll(dueDate[:10], "-", "")
					events = append(events, calEvent{
						uid:     fmt.Sprintf("task-%s@realtourflow", id),
						dtstart: dateStr,
						summary: fmt.Sprintf("%s — %s", title, dealTitle),
						desc:    "Task deadline",
					})
				}
			}
		}
	}

	now := time.Now().UTC().Format("20060102T150405Z")

	var sb strings.Builder
	sb.WriteString("BEGIN:VCALENDAR\r\n")
	sb.WriteString("VERSION:2.0\r\n")
	sb.WriteString("PRODID:-//RealTourFlow//Calendar//EN\r\n")
	sb.WriteString("X-WR-CALNAME:RealTourFlow\r\n")
	sb.WriteString("X-WR-TIMEZONE:America/Chicago\r\n")
	sb.WriteString("CALSCALE:GREGORIAN\r\n")
	sb.WriteString("METHOD:PUBLISH\r\n")

	for _, e := range events {
		sb.WriteString("BEGIN:VEVENT\r\n")
		sb.WriteString(fmt.Sprintf("UID:%s\r\n", e.uid))
		sb.WriteString(fmt.Sprintf("DTSTART;VALUE=DATE:%s\r\n", e.dtstart))
		sb.WriteString(fmt.Sprintf("DTEND;VALUE=DATE:%s\r\n", nextDay(e.dtstart)))
		sb.WriteString(fmt.Sprintf("SUMMARY:%s\r\n", icalEscape(e.summary)))
		if e.desc != "" {
			sb.WriteString(fmt.Sprintf("DESCRIPTION:%s\r\n", icalEscape(e.desc)))
		}
		sb.WriteString(fmt.Sprintf("DTSTAMP:%s\r\n", now))
		sb.WriteString("END:VEVENT\r\n")
	}

	sb.WriteString("END:VCALENDAR\r\n")

	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="realtourflow.ics"`)
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(sb.String()))
}

// nextDay advances an iCal date string (YYYYMMDD) by one day.
func nextDay(dateStr string) string {
	t, err := time.Parse("20060102", dateStr)
	if err != nil {
		return dateStr
	}
	return t.AddDate(0, 0, 1).Format("20060102")
}

func icalEscape(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, ";", `\;`)
	s = strings.ReplaceAll(s, ",", `\,`)
	s = strings.ReplaceAll(s, "\n", `\n`)
	return s
}
