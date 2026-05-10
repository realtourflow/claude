package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"realtourflow/internal/middleware"
)

type apiContingency struct {
	ID              string  `json:"id"`
	DealID          string  `json:"deal_id"`
	Label           string  `json:"label"`
	Type            string  `json:"contingency_type"`
	Deadline        *string `json:"deadline,omitempty"`
	Status          string  `json:"status"`
	Notes           *string `json:"notes,omitempty"`
	SortOrder       int     `json:"sort_order"`
	CreatedAt       string  `json:"created_at"`
}

func contingencyAccess(r *http.Request, db *sql.DB, dealID string) (userID string, ok bool) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		return "", false
	}

	uid, err := resolveUserID(r.Context(), db, claims.RegisteredClaims.Subject)
	if err != nil {
		return "", false
	}

	for _, role := range middleware.GetRoles(r) {
		if role == "tc" || role == "admin" {
			return uid, true
		}
	}

	// Agent who owns the deal
	var ownerID string
	if err := db.QueryRowContext(r.Context(), `SELECT agent_id FROM deals WHERE id = $1`, dealID).Scan(&ownerID); err == nil && ownerID == uid {
		return uid, true
	}

	return "", false
}

func scanContingency(rows *sql.Rows) (apiContingency, error) {
	var c apiContingency
	var deadline sql.NullString
	var notes sql.NullString
	var waivedAt, metAt sql.NullTime
	var createdAt time.Time

	err := rows.Scan(&c.ID, &c.DealID, &c.Label, &c.Type, &deadline, &waivedAt, &metAt, &notes, &c.SortOrder, &createdAt)
	if err != nil {
		return c, err
	}
	if deadline.Valid {
		c.Deadline = &deadline.String
	}
	if notes.Valid {
		c.Notes = &notes.String
	}
	switch {
	case waivedAt.Valid:
		c.Status = "waived"
	case metAt.Valid:
		c.Status = "removed"
	default:
		c.Status = "active"
	}
	c.CreatedAt = createdAt.Format(time.RFC3339)
	return c, nil
}

func (h *Handler) ListContingencies(w http.ResponseWriter, r *http.Request) {
	dealID := chi.URLParam(r, "dealId")
	if _, ok := contingencyAccess(r, h.db, dealID); !ok {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT id, deal_id, label, contingency_type, deadline::text, waived_at, met_at, notes, sort_order, created_at
		FROM deal_contingencies
		WHERE deal_id = $1
		ORDER BY sort_order, created_at
	`, dealID)
	if err != nil {
		http.Error(w, "failed to list contingencies", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var result []apiContingency
	for rows.Next() {
		c, err := scanContingency(rows)
		if err != nil {
			http.Error(w, "failed to scan contingency", http.StatusInternalServerError)
			return
		}
		result = append(result, c)
	}
	if result == nil {
		result = []apiContingency{}
	}
	respond(w, http.StatusOK, result)
}

func (h *Handler) CreateContingency(w http.ResponseWriter, r *http.Request) {
	dealID := chi.URLParam(r, "dealId")
	if _, ok := contingencyAccess(r, h.db, dealID); !ok {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var req struct {
		Label    string  `json:"label"`
		Type     string  `json:"contingency_type"`
		Deadline *string `json:"deadline"`
		Notes    *string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Label == "" {
		http.Error(w, "label is required", http.StatusBadRequest)
		return
	}
	if req.Type == "" {
		req.Type = "custom"
	}

	var sortOrder int
	_ = h.db.QueryRowContext(r.Context(), `
		SELECT COALESCE(MAX(sort_order), -1) + 1 FROM deal_contingencies WHERE deal_id = $1
	`, dealID).Scan(&sortOrder)

	rows, err := h.db.QueryContext(r.Context(), `
		INSERT INTO deal_contingencies (deal_id, label, contingency_type, deadline, notes, sort_order)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, deal_id, label, contingency_type, deadline::text, waived_at, met_at, notes, sort_order, created_at
	`, dealID, req.Label, req.Type, req.Deadline, req.Notes, sortOrder)
	if err != nil {
		http.Error(w, "failed to create contingency", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	if !rows.Next() {
		http.Error(w, "failed to read created contingency", http.StatusInternalServerError)
		return
	}
	c, err := scanContingency(rows)
	if err != nil {
		http.Error(w, "failed to scan contingency", http.StatusInternalServerError)
		return
	}
	respond(w, http.StatusCreated, c)
}

func (h *Handler) UpdateContingency(w http.ResponseWriter, r *http.Request) {
	dealID := chi.URLParam(r, "dealId")
	contingencyID := chi.URLParam(r, "contingencyId")

	if _, ok := contingencyAccess(r, h.db, dealID); !ok {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var req struct {
		Label    *string `json:"label"`
		Deadline *string `json:"deadline"`
		Notes    *string `json:"notes"`
		Status   *string `json:"status"` // "active" | "waived" | "removed"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// Build the update
	if req.Label != nil {
		_, _ = h.db.ExecContext(r.Context(), `UPDATE deal_contingencies SET label = $1, updated_at = NOW() WHERE id = $2 AND deal_id = $3`, *req.Label, contingencyID, dealID)
	}
	if req.Deadline != nil {
		_, _ = h.db.ExecContext(r.Context(), `UPDATE deal_contingencies SET deadline = $1, updated_at = NOW() WHERE id = $2 AND deal_id = $3`, *req.Deadline, contingencyID, dealID)
	}
	if req.Notes != nil {
		_, _ = h.db.ExecContext(r.Context(), `UPDATE deal_contingencies SET notes = $1, updated_at = NOW() WHERE id = $2 AND deal_id = $3`, *req.Notes, contingencyID, dealID)
	}
	if req.Status != nil {
		switch *req.Status {
		case "waived":
			_, _ = h.db.ExecContext(r.Context(), `UPDATE deal_contingencies SET waived_at = NOW(), met_at = NULL, updated_at = NOW() WHERE id = $1 AND deal_id = $2`, contingencyID, dealID)
		case "removed":
			_, _ = h.db.ExecContext(r.Context(), `UPDATE deal_contingencies SET met_at = NOW(), waived_at = NULL, updated_at = NOW() WHERE id = $1 AND deal_id = $2`, contingencyID, dealID)
		case "active":
			_, _ = h.db.ExecContext(r.Context(), `UPDATE deal_contingencies SET waived_at = NULL, met_at = NULL, updated_at = NOW() WHERE id = $1 AND deal_id = $2`, contingencyID, dealID)
		}
	}

	// Return updated record
	rows, err := h.db.QueryContext(r.Context(), `
		SELECT id, deal_id, label, contingency_type, deadline::text, waived_at, met_at, notes, sort_order, created_at
		FROM deal_contingencies
		WHERE id = $1 AND deal_id = $2
	`, contingencyID, dealID)
	if err != nil || !rows.Next() {
		http.Error(w, "contingency not found", http.StatusNotFound)
		return
	}
	defer rows.Close()

	c, err := scanContingency(rows)
	if err != nil {
		http.Error(w, "failed to scan contingency", http.StatusInternalServerError)
		return
	}
	respond(w, http.StatusOK, c)
}

func (h *Handler) DeleteContingency(w http.ResponseWriter, r *http.Request) {
	dealID := chi.URLParam(r, "dealId")
	contingencyID := chi.URLParam(r, "contingencyId")

	if _, ok := contingencyAccess(r, h.db, dealID); !ok {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	res, err := h.db.ExecContext(r.Context(), `
		DELETE FROM deal_contingencies WHERE id = $1 AND deal_id = $2
	`, contingencyID, dealID)
	if err != nil {
		http.Error(w, "failed to delete contingency", http.StatusInternalServerError)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	respond(w, http.StatusNoContent, nil)
}
