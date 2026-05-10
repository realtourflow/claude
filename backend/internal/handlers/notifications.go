package handlers

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"realtourflow/internal/middleware"
)

type apiNotification struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Body      *string `json:"body,omitempty"`
	Type      string  `json:"type"`
	DealID    *string `json:"deal_id,omitempty"`
	Href      *string `json:"href,omitempty"`
	Read      bool    `json:"read"`
	CreatedAt string  `json:"created_at"`
}

// ListNotifications — returns the current user's notifications (unread first, then read, limit 50).
func (h *Handler) ListNotifications(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	userID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusUnauthorized)
		return
	}

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT id, title, body, type, deal_id, href, read_at, created_at
		FROM notifications
		WHERE user_id = $1
		ORDER BY read_at IS NOT NULL, created_at DESC
		LIMIT 50
	`, userID)
	if err != nil {
		http.Error(w, "failed to list notifications", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var result []apiNotification
	for rows.Next() {
		var n apiNotification
		var body, dealID, href sql.NullString
		var readAt sql.NullTime
		var createdAt time.Time
		if err := rows.Scan(&n.ID, &n.Title, &body, &n.Type, &dealID, &href, &readAt, &createdAt); err != nil {
			http.Error(w, "failed to scan notification", http.StatusInternalServerError)
			return
		}
		if body.Valid {
			n.Body = &body.String
		}
		if dealID.Valid {
			n.DealID = &dealID.String
		}
		if href.Valid {
			n.Href = &href.String
		}
		n.Read = readAt.Valid
		n.CreatedAt = createdAt.Format(time.RFC3339)
		result = append(result, n)
	}
	if result == nil {
		result = []apiNotification{}
	}
	respond(w, http.StatusOK, result)
}

// MarkNotificationRead — marks a single notification as read.
func (h *Handler) MarkNotificationRead(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	userID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusUnauthorized)
		return
	}

	notifID := chi.URLParam(r, "notifId")

	res, err := h.db.ExecContext(r.Context(), `
		UPDATE notifications SET read_at = NOW()
		WHERE id = $1 AND user_id = $2 AND read_at IS NULL
	`, notifID, userID)
	if err != nil {
		http.Error(w, "failed to mark read", http.StatusInternalServerError)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	respond(w, http.StatusOK, map[string]bool{"ok": true})
}

// MarkAllNotificationsRead — marks all unread notifications as read for the current user.
func (h *Handler) MarkAllNotificationsRead(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	userID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusUnauthorized)
		return
	}

	_, err = h.db.ExecContext(r.Context(), `
		UPDATE notifications SET read_at = NOW()
		WHERE user_id = $1 AND read_at IS NULL
	`, userID)
	if err != nil {
		http.Error(w, "failed to mark all read", http.StatusInternalServerError)
		return
	}
	respond(w, http.StatusOK, map[string]bool{"ok": true})
}

// CreateNotification — internal helper used by other handlers to post notifications.
func (h *Handler) createNotification(userID, title, body, notifType string, dealID *string, href *string) {
	_, _ = h.db.Exec(`
		INSERT INTO notifications (user_id, title, body, type, deal_id, href)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, userID, title, body, notifType, dealID, href)
}
