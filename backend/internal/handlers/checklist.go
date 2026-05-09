package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"realtourflow/internal/middleware"
)

type checklistItem struct {
	ID         string  `json:"id"`
	DealID     string  `json:"deal_id"`
	Label      string  `json:"label"`
	Category   string  `json:"category"`
	Checked    bool    `json:"checked"`
	AssignedTo string  `json:"assigned_to"`
	DueDate    *string `json:"due_date,omitempty"`
	IsCustom   bool    `json:"is_custom"`
	SortOrder  int     `json:"sort_order"`
}

type defaultItem struct {
	Label      string
	Category   string
	AssignedTo string
}

var defaultChecklistItems = []defaultItem{
	{Label: "Contract received and reviewed", Category: "Contract", AssignedTo: "tc"},
	{Label: "Earnest money deposit verified", Category: "Contract", AssignedTo: "tc"},
	{Label: "All parties have signed contract", Category: "Contract", AssignedTo: "tc"},
	{Label: "Loan application submitted", Category: "Loan", AssignedTo: "tc"},
	{Label: "Disclosures out", Category: "Loan", AssignedTo: "tc"},
	{Label: "Disclosures signed and submitted", Category: "Loan", AssignedTo: "tc"},
	{Label: "Approved with conditions", Category: "Loan", AssignedTo: "tc"},
	{Label: "Appraisal ordered", Category: "Loan", AssignedTo: "tc"},
	{Label: "Clear to close received", Category: "Loan", AssignedTo: "tc"},
	{Label: "Title ordered", Category: "Title", AssignedTo: "tc"},
	{Label: "Title search complete", Category: "Title", AssignedTo: "tc"},
	{Label: "Title commitment received", Category: "Title", AssignedTo: "tc"},
	{Label: "Wire instructions confirmed", Category: "Title", AssignedTo: "tc"},
	{Label: "Closing date confirmed with all parties", Category: "Closing", AssignedTo: "tc"},
	{Label: "Closing disclosure sent", Category: "Closing", AssignedTo: "tc"},
	{Label: "Final walkthrough scheduled", Category: "Closing", AssignedTo: "agent"},
	{Label: "Keys and access items prepared", Category: "Closing", AssignedTo: "tc"},
}

var checklistEligibleStages = map[string]bool{
	"under_contract": true,
	"pre_close":      true,
	"closing":        true,
	"post_close":     true,
}

func (h *Handler) checklistAccess(r *http.Request, dealID, userID string) bool {
	for _, role := range middleware.GetRoles(r) {
		if role == "tc" || role == "admin" {
			return true
		}
	}
	var count int
	h.db.QueryRowContext(r.Context(), `
		SELECT COUNT(*) FROM deals
		WHERE id = $1 AND (
			agent_id = $2 OR
			EXISTS (SELECT 1 FROM deal_participants WHERE deal_id = $1 AND user_id = $2)
		)
	`, dealID, userID).Scan(&count)
	return count > 0
}

// ListChecklist returns checklist items for a deal.
// Auto-seeds defaults if the deal is in an eligible stage and has no items yet.
func (h *Handler) ListChecklist(w http.ResponseWriter, r *http.Request) {
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
	dealID := chi.URLParam(r, "dealId")
	if !h.checklistAccess(r, dealID, userID) {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	// Check if items already exist
	var count int
	h.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM checklist_items WHERE deal_id = $1`, dealID).Scan(&count)

	// Auto-seed if eligible stage and empty
	if count == 0 {
		var stage string
		h.db.QueryRowContext(r.Context(), `SELECT stage FROM deals WHERE id = $1`, dealID).Scan(&stage)
		if checklistEligibleStages[stage] {
			for i, item := range defaultChecklistItems {
				h.db.ExecContext(r.Context(), `
					INSERT INTO checklist_items (deal_id, label, category, assigned_to, sort_order)
					VALUES ($1, $2, $3, $4, $5)
				`, dealID, item.Label, item.Category, item.AssignedTo, i)
			}
		}
	}

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT id, deal_id, label, category, checked, assigned_to, due_date, is_custom, sort_order
		FROM checklist_items
		WHERE deal_id = $1
		ORDER BY sort_order, created_at
	`, dealID)
	if err != nil {
		http.Error(w, "failed to fetch checklist", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	items := make([]checklistItem, 0)
	for rows.Next() {
		var it checklistItem
		var dueDateRaw *time.Time
		if err := rows.Scan(&it.ID, &it.DealID, &it.Label, &it.Category, &it.Checked, &it.AssignedTo, &dueDateRaw, &it.IsCustom, &it.SortOrder); err != nil {
			http.Error(w, "failed to scan item", http.StatusInternalServerError)
			return
		}
		if dueDateRaw != nil {
			s := dueDateRaw.Format("2006-01-02")
			it.DueDate = &s
		}
		items = append(items, it)
	}

	respond(w, http.StatusOK, items)
}

// CreateChecklistItem adds a custom item to a deal's checklist.
func (h *Handler) CreateChecklistItem(w http.ResponseWriter, r *http.Request) {
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
	dealID := chi.URLParam(r, "dealId")
	if !h.checklistAccess(r, dealID, userID) {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	var req struct {
		Label      string `json:"label"`
		Category   string `json:"category"`
		AssignedTo string `json:"assigned_to"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Label == "" {
		http.Error(w, "label is required", http.StatusBadRequest)
		return
	}
	if req.Category == "" {
		req.Category = "Contract"
	}
	if req.AssignedTo == "" {
		req.AssignedTo = "tc"
	}

	var maxOrder int
	h.db.QueryRowContext(r.Context(), `SELECT COALESCE(MAX(sort_order), -1) FROM checklist_items WHERE deal_id = $1`, dealID).Scan(&maxOrder)

	var it checklistItem
	if err := h.db.QueryRowContext(r.Context(), `
		INSERT INTO checklist_items (deal_id, label, category, assigned_to, is_custom, sort_order)
		VALUES ($1, $2, $3, $4, TRUE, $5)
		RETURNING id, deal_id, label, category, checked, assigned_to, due_date, is_custom, sort_order
	`, dealID, req.Label, req.Category, req.AssignedTo, maxOrder+1).Scan(
		&it.ID, &it.DealID, &it.Label, &it.Category, &it.Checked, &it.AssignedTo, &it.DueDate, &it.IsCustom, &it.SortOrder,
	); err != nil {
		http.Error(w, "failed to create item", http.StatusInternalServerError)
		return
	}
	respond(w, http.StatusOK, it)
}

// UpdateChecklistItem patches checked, assigned_to, or due_date on a checklist item.
func (h *Handler) UpdateChecklistItem(w http.ResponseWriter, r *http.Request) {
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
	dealID := chi.URLParam(r, "dealId")
	itemID := chi.URLParam(r, "itemId")
	if !h.checklistAccess(r, dealID, userID) {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	var req struct {
		Checked    *bool   `json:"checked"`
		AssignedTo *string `json:"assigned_to"`
		DueDate    *string `json:"due_date"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	if req.Checked != nil {
		h.db.ExecContext(r.Context(), `UPDATE checklist_items SET checked = $1, updated_at = NOW() WHERE id = $2 AND deal_id = $3`, *req.Checked, itemID, dealID)
	}
	if req.AssignedTo != nil {
		h.db.ExecContext(r.Context(), `UPDATE checklist_items SET assigned_to = $1, updated_at = NOW() WHERE id = $2 AND deal_id = $3`, *req.AssignedTo, itemID, dealID)
	}
	if req.DueDate != nil {
		if *req.DueDate == "" {
			h.db.ExecContext(r.Context(), `UPDATE checklist_items SET due_date = NULL, updated_at = NOW() WHERE id = $1 AND deal_id = $2`, itemID, dealID)
		} else {
			h.db.ExecContext(r.Context(), `UPDATE checklist_items SET due_date = $1, updated_at = NOW() WHERE id = $2 AND deal_id = $3`, *req.DueDate, itemID, dealID)
		}
	}

	var it checklistItem
	var dueDateRaw *time.Time
	if err := h.db.QueryRowContext(r.Context(), `
		SELECT id, deal_id, label, category, checked, assigned_to, due_date, is_custom, sort_order
		FROM checklist_items WHERE id = $1 AND deal_id = $2
	`, itemID, dealID).Scan(
		&it.ID, &it.DealID, &it.Label, &it.Category, &it.Checked, &it.AssignedTo, &dueDateRaw, &it.IsCustom, &it.SortOrder,
	); err != nil {
		http.Error(w, "item not found", http.StatusNotFound)
		return
	}
	if dueDateRaw != nil {
		s := dueDateRaw.Format("2006-01-02")
		it.DueDate = &s
	}
	respond(w, http.StatusOK, it)
}

// DeleteChecklistItem removes a checklist item (custom items only for non-TC roles).
func (h *Handler) DeleteChecklistItem(w http.ResponseWriter, r *http.Request) {
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
	dealID := chi.URLParam(r, "dealId")
	itemID := chi.URLParam(r, "itemId")
	if !h.checklistAccess(r, dealID, userID) {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	h.db.ExecContext(r.Context(), `DELETE FROM checklist_items WHERE id = $1 AND deal_id = $2`, itemID, dealID)
	respond(w, http.StatusOK, map[string]string{"status": "ok"})
}
