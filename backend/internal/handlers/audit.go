package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"
)

// logAudit writes an audit entry asynchronously; never blocks or propagates errors.
func (h *Handler) logAudit(actorID *string, eventType string, dealID *string, targetID *string, metadata map[string]any) {
	go func() {
		raw, _ := json.Marshal(metadata)
		h.db.ExecContext(context.Background(),
			`INSERT INTO audit_log (actor_id, event_type, deal_id, target_id, metadata)
			 VALUES ($1, $2, $3, $4, $5)`,
			actorID, eventType, dealID, targetID, raw,
		)
	}()
}

// ─── List Audit Log ────────────────────────────────────────────────────────────

type apiAuditEntry struct {
	ID         string          `json:"id"`
	ActorID    *string         `json:"actor_id"`
	ActorName  *string         `json:"actor_name"`
	ActorEmail *string         `json:"actor_email"`
	EventType  string          `json:"event_type"`
	DealID     *string         `json:"deal_id"`
	DealTitle  *string         `json:"deal_title"`
	TargetID   *string         `json:"target_id"`
	Metadata   json.RawMessage `json:"metadata"`
	CreatedAt  string          `json:"created_at"`
}

func (h *Handler) ListAuditLog(w http.ResponseWriter, r *http.Request) {
	if !adminOnly(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	limit, offset := 100, 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	var eventTypeFilter *string
	if v := r.URL.Query().Get("event_type"); v != "" {
		eventTypeFilter = &v
	}

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT a.id, a.actor_id, u.name, u.email,
		       a.event_type, a.deal_id, d.title,
		       a.target_id, a.metadata, a.created_at
		FROM audit_log a
		LEFT JOIN users u ON u.id = a.actor_id
		LEFT JOIN deals d ON d.id = a.deal_id
		WHERE ($1::text IS NULL OR a.event_type = $1)
		ORDER BY a.created_at DESC
		LIMIT $2 OFFSET $3
	`, eventTypeFilter, limit, offset)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	entries := []apiAuditEntry{}
	for rows.Next() {
		var e apiAuditEntry
		var createdAt time.Time
		var meta []byte
		if err := rows.Scan(
			&e.ID, &e.ActorID, &e.ActorName, &e.ActorEmail,
			&e.EventType, &e.DealID, &e.DealTitle,
			&e.TargetID, &meta, &createdAt,
		); err != nil {
			continue
		}
		if len(meta) > 0 {
			e.Metadata = json.RawMessage(meta)
		} else {
			e.Metadata = json.RawMessage("null")
		}
		e.CreatedAt = createdAt.Format(time.RFC3339)
		entries = append(entries, e)
	}

	var total int
	h.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM audit_log WHERE ($1::text IS NULL OR event_type = $1)`,
		eventTypeFilter,
	).Scan(&total)

	respond(w, http.StatusOK, map[string]any{"entries": entries, "total": total})
}
