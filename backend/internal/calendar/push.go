package calendar

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

// Event is a calendar entry to push to a connected provider.
type Event struct {
	// InternalUID is the stable identifier we use to find this event again on
	// update/delete (e.g. "close-<dealId>" or "task-<taskId>").
	InternalUID string
	Summary     string
	Description string
	Location    string
	// Start/End. If AllDay is true, only the date part is used.
	Start  time.Time
	End    time.Time
	AllDay bool
}

// Pusher is the interface a calendar provider must satisfy.
type Pusher interface {
	// Upsert creates the event if it doesn't exist, otherwise patches it.
	Upsert(ctx context.Context, db *sql.DB, userID string, ev Event) error
	// Delete removes the event by its internal UID, if present.
	Delete(ctx context.Context, db *sql.DB, userID string, internalUID string) error
	// Provider name used in oauth_tokens / calendar_event_map rows.
	Provider() string
}

// FanOut pushes an event to every calendar provider the user has connected.
// Errors per provider are logged but don't fail the operation — calendar push
// is best-effort and must not block a deal mutation.
func FanOut(ctx context.Context, db *sql.DB, userID string, ev Event, pushers ...Pusher) {
	for _, p := range pushers {
		if p == nil {
			continue
		}
		token, err := LoadToken(ctx, db, userID, p.Provider())
		if err != nil || token == nil {
			continue
		}
		if err := p.Upsert(ctx, db, userID, ev); err != nil {
			log.Printf("calendar push to %s for user %s failed: %v", p.Provider(), userID, err)
		}
	}
}

// FanOutDelete removes an event from every connected calendar.
func FanOutDelete(ctx context.Context, db *sql.DB, userID string, internalUID string, pushers ...Pusher) {
	for _, p := range pushers {
		if p == nil {
			continue
		}
		token, err := LoadToken(ctx, db, userID, p.Provider())
		if err != nil || token == nil {
			continue
		}
		if err := p.Delete(ctx, db, userID, internalUID); err != nil {
			log.Printf("calendar delete on %s for user %s failed: %v", p.Provider(), userID, err)
		}
	}
}

// loadMapping returns the external event ID (if any) for (user, provider, internalUID).
func loadMapping(ctx context.Context, db *sql.DB, userID, provider, internalUID string) (string, error) {
	var externalID string
	err := db.QueryRowContext(ctx, `
		SELECT external_event_id FROM calendar_event_map
		WHERE user_id = $1 AND provider = $2 AND internal_uid = $3
	`, userID, provider, internalUID).Scan(&externalID)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return externalID, err
}

func saveMapping(ctx context.Context, db *sql.DB, userID, provider, internalUID, externalID string) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO calendar_event_map (user_id, provider, internal_uid, external_event_id)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, provider, internal_uid) DO UPDATE
		SET external_event_id = EXCLUDED.external_event_id,
		    updated_at = NOW()
	`, userID, provider, internalUID, externalID)
	return err
}

func deleteMapping(ctx context.Context, db *sql.DB, userID, provider, internalUID string) error {
	_, err := db.ExecContext(ctx, `
		DELETE FROM calendar_event_map
		WHERE user_id = $1 AND provider = $2 AND internal_uid = $3
	`, userID, provider, internalUID)
	return err
}

// ─── Google Calendar ────────────────────────────────────────────────────────────

type GooglePusher struct {
	Config ProviderConfig
}

func (g *GooglePusher) Provider() string { return ProviderGoogle }

type googleDate struct {
	Date     string `json:"date,omitempty"`
	DateTime string `json:"dateTime,omitempty"`
	TimeZone string `json:"timeZone,omitempty"`
}

type googleEvent struct {
	ID          string     `json:"id,omitempty"`
	Summary     string     `json:"summary"`
	Description string     `json:"description,omitempty"`
	Location    string     `json:"location,omitempty"`
	Start       googleDate `json:"start"`
	End         googleDate `json:"end"`
	Source      *struct {
		Title string `json:"title"`
		URL   string `json:"url"`
	} `json:"source,omitempty"`
}

func googlePayload(ev Event) googleEvent {
	body := googleEvent{Summary: ev.Summary, Description: ev.Description, Location: ev.Location}
	if ev.AllDay {
		body.Start = googleDate{Date: ev.Start.Format("2006-01-02")}
		body.End = googleDate{Date: ev.End.Format("2006-01-02")}
	} else {
		body.Start = googleDate{DateTime: ev.Start.Format(time.RFC3339), TimeZone: "America/Chicago"}
		body.End = googleDate{DateTime: ev.End.Format(time.RFC3339), TimeZone: "America/Chicago"}
	}
	return body
}

func (g *GooglePusher) Upsert(ctx context.Context, db *sql.DB, userID string, ev Event) error {
	tok, err := LoadToken(ctx, db, userID, ProviderGoogle)
	if err != nil || tok == nil {
		return errors.New("no google calendar token for user")
	}
	tok, err = g.Config.EnsureFresh(ctx, db, tok)
	if err != nil {
		return err
	}

	externalID, _ := loadMapping(ctx, db, userID, ProviderGoogle, ev.InternalUID)
	body, _ := json.Marshal(googlePayload(ev))

	method := http.MethodPost
	url := "https://www.googleapis.com/calendar/v3/calendars/primary/events"
	if externalID != "" {
		method = http.MethodPatch
		url = "https://www.googleapis.com/calendar/v3/calendars/primary/events/" + externalID
	}

	req, _ := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// If the previously mapped event was deleted in Google directly, the PATCH
	// will 404 — fall through to a fresh insert.
	if externalID != "" && resp.StatusCode == http.StatusNotFound {
		_ = deleteMapping(ctx, db, userID, ProviderGoogle, ev.InternalUID)
		return g.Upsert(ctx, db, userID, ev)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("google calendar %s returned %d: %s", method, resp.StatusCode, string(respBody))
	}

	var out googleEvent
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return fmt.Errorf("decode google response: %w", err)
	}
	return saveMapping(ctx, db, userID, ProviderGoogle, ev.InternalUID, out.ID)
}

func (g *GooglePusher) Delete(ctx context.Context, db *sql.DB, userID string, internalUID string) error {
	externalID, err := loadMapping(ctx, db, userID, ProviderGoogle, internalUID)
	if err != nil || externalID == "" {
		return nil
	}
	tok, err := LoadToken(ctx, db, userID, ProviderGoogle)
	if err != nil || tok == nil {
		return nil
	}
	tok, err = g.Config.EnsureFresh(ctx, db, tok)
	if err != nil {
		return err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodDelete,
		"https://www.googleapis.com/calendar/v3/calendars/primary/events/"+externalID, nil)
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	// 410 Gone and 404 mean it's already gone; treat as success.
	if resp.StatusCode >= 200 && resp.StatusCode < 300 ||
		resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone {
		return deleteMapping(ctx, db, userID, ProviderGoogle, internalUID)
	}
	respBody, _ := io.ReadAll(resp.Body)
	return fmt.Errorf("google calendar DELETE returned %d: %s", resp.StatusCode, string(respBody))
}

// ─── Microsoft Graph (Outlook / Office 365) ────────────────────────────────────

type MicrosoftPusher struct {
	Config ProviderConfig
}

func (m *MicrosoftPusher) Provider() string { return ProviderMicrosoft }

type msDateTime struct {
	DateTime string `json:"dateTime"`
	TimeZone string `json:"timeZone"`
}

type msEvent struct {
	ID         string     `json:"id,omitempty"`
	Subject    string     `json:"subject"`
	Body       *msBody    `json:"body,omitempty"`
	Start      msDateTime `json:"start"`
	End        msDateTime `json:"end"`
	IsAllDay   bool       `json:"isAllDay,omitempty"`
	Location   *msLoc     `json:"location,omitempty"`
}

type msBody struct {
	ContentType string `json:"contentType"`
	Content     string `json:"content"`
}

type msLoc struct {
	DisplayName string `json:"displayName"`
}

func msPayload(ev Event) msEvent {
	body := msEvent{Subject: ev.Summary, IsAllDay: ev.AllDay}
	if ev.Description != "" {
		body.Body = &msBody{ContentType: "text", Content: ev.Description}
	}
	if ev.Location != "" {
		body.Location = &msLoc{DisplayName: ev.Location}
	}
	if ev.AllDay {
		// Microsoft requires midnight–midnight UTC for all-day events.
		body.Start = msDateTime{DateTime: ev.Start.Format("2006-01-02T00:00:00"), TimeZone: "UTC"}
		body.End = msDateTime{DateTime: ev.End.Format("2006-01-02T00:00:00"), TimeZone: "UTC"}
	} else {
		body.Start = msDateTime{DateTime: ev.Start.UTC().Format("2006-01-02T15:04:05"), TimeZone: "UTC"}
		body.End = msDateTime{DateTime: ev.End.UTC().Format("2006-01-02T15:04:05"), TimeZone: "UTC"}
	}
	return body
}

func (m *MicrosoftPusher) Upsert(ctx context.Context, db *sql.DB, userID string, ev Event) error {
	tok, err := LoadToken(ctx, db, userID, ProviderMicrosoft)
	if err != nil || tok == nil {
		return errors.New("no microsoft calendar token for user")
	}
	tok, err = m.Config.EnsureFresh(ctx, db, tok)
	if err != nil {
		return err
	}

	externalID, _ := loadMapping(ctx, db, userID, ProviderMicrosoft, ev.InternalUID)
	body, _ := json.Marshal(msPayload(ev))

	method := http.MethodPost
	url := "https://graph.microsoft.com/v1.0/me/events"
	if externalID != "" {
		method = http.MethodPatch
		url = "https://graph.microsoft.com/v1.0/me/events/" + externalID
	}

	req, _ := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if externalID != "" && resp.StatusCode == http.StatusNotFound {
		_ = deleteMapping(ctx, db, userID, ProviderMicrosoft, ev.InternalUID)
		return m.Upsert(ctx, db, userID, ev)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("microsoft graph %s returned %d: %s", method, resp.StatusCode, string(respBody))
	}

	var out msEvent
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return fmt.Errorf("decode microsoft response: %w", err)
	}
	return saveMapping(ctx, db, userID, ProviderMicrosoft, ev.InternalUID, out.ID)
}

func (m *MicrosoftPusher) Delete(ctx context.Context, db *sql.DB, userID string, internalUID string) error {
	externalID, err := loadMapping(ctx, db, userID, ProviderMicrosoft, internalUID)
	if err != nil || externalID == "" {
		return nil
	}
	tok, err := LoadToken(ctx, db, userID, ProviderMicrosoft)
	if err != nil || tok == nil {
		return nil
	}
	tok, err = m.Config.EnsureFresh(ctx, db, tok)
	if err != nil {
		return err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodDelete,
		"https://graph.microsoft.com/v1.0/me/events/"+externalID, nil)
	req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 ||
		resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone {
		return deleteMapping(ctx, db, userID, ProviderMicrosoft, internalUID)
	}
	respBody, _ := io.ReadAll(resp.Body)
	return fmt.Errorf("microsoft graph DELETE returned %d: %s", resp.StatusCode, string(respBody))
}
