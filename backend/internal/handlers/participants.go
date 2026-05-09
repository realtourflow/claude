package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"realtourflow/internal/middleware"
	"realtourflow/internal/models"
)

type participantRow struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Email string  `json:"email"`
	Phone *string `json:"phone,omitempty"`
	Role  string  `json:"role"`
}

type myDealRow struct {
	models.Deal
	AgentName  string  `json:"agent_name"`
	AgentEmail string  `json:"agent_email"`
	AgentPhone *string `json:"agent_phone,omitempty"`
}

// ListMyDeals returns deals where the authenticated user is a participant.
func (h *Handler) ListMyDeals(w http.ResponseWriter, r *http.Request) {
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

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT deals.id, deals.agent_id, deals.type, deals.stage, `+healthExpr+` AS health,
		       deals.title, deals.address, deals.price, deals.arive_linked, deals.created_at, deals.updated_at,
		       u.name, u.email, u.phone
		FROM deals
		JOIN deal_participants dp ON dp.deal_id = deals.id AND dp.user_id = $1
		JOIN users u ON u.id = deals.agent_id
		ORDER BY deals.updated_at DESC
	`, userID)
	if err != nil {
		http.Error(w, "failed to fetch deals", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := make([]myDealRow, 0)
	for rows.Next() {
		var d myDealRow
		if err := rows.Scan(
			&d.ID, &d.AgentID, &d.Type, &d.Stage, &d.Health,
			&d.Title, &d.Address, &d.Price, &d.AriveLinked, &d.CreatedAt, &d.UpdatedAt,
			&d.AgentName, &d.AgentEmail, &d.AgentPhone,
		); err != nil {
			http.Error(w, "failed to scan deal", http.StatusInternalServerError)
			return
		}
		result = append(result, d)
	}

	respond(w, http.StatusOK, result)
}

// ListParticipants returns all participants for a deal.
// Accessible by the deal's agent or any participant.
func (h *Handler) ListParticipants(w http.ResponseWriter, r *http.Request) {
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

	var access int
	h.db.QueryRowContext(r.Context(), `
		SELECT COUNT(*) FROM deals
		WHERE id = $1 AND (
			agent_id = $2 OR
			EXISTS (SELECT 1 FROM deal_participants WHERE deal_id = $1 AND user_id = $2)
		)
	`, dealID, userID).Scan(&access)
	if access == 0 {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT u.id, u.name, u.email, u.phone, dp.role
		FROM deal_participants dp
		JOIN users u ON u.id = dp.user_id
		WHERE dp.deal_id = $1
		ORDER BY u.name
	`, dealID)
	if err != nil {
		http.Error(w, "failed to fetch participants", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := make([]participantRow, 0)
	for rows.Next() {
		var p participantRow
		if err := rows.Scan(&p.ID, &p.Name, &p.Email, &p.Phone, &p.Role); err != nil {
			http.Error(w, "failed to scan participant", http.StatusInternalServerError)
			return
		}
		result = append(result, p)
	}

	respond(w, http.StatusOK, result)
}

// AddParticipant links a user to a deal. Only the deal's agent may call this.
func (h *Handler) AddParticipant(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	agentUserID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	dealID := chi.URLParam(r, "dealId")

	var ownerID string
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT agent_id FROM deals WHERE id = $1`, dealID,
	).Scan(&ownerID); err != nil || ownerID != agentUserID {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	var req struct {
		UserID string `json:"user_id"`
		Role   string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UserID == "" || req.Role == "" {
		http.Error(w, "user_id and role are required", http.StatusBadRequest)
		return
	}

	_, err = h.db.ExecContext(r.Context(), `
		INSERT INTO deal_participants (deal_id, user_id, role)
		VALUES ($1, $2, $3)
		ON CONFLICT (deal_id, user_id) DO UPDATE SET role = EXCLUDED.role
	`, dealID, req.UserID, req.Role)
	if err != nil {
		http.Error(w, "failed to add participant", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusOK, map[string]string{"status": "ok"})
}

// RemoveParticipant unlinks a user from a deal. Only the deal's agent may call this.
func (h *Handler) RemoveParticipant(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	agentUserID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	dealID := chi.URLParam(r, "dealId")
	participantID := chi.URLParam(r, "userId")

	var ownerID string
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT agent_id FROM deals WHERE id = $1`, dealID,
	).Scan(&ownerID); err != nil || ownerID != agentUserID {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	h.db.ExecContext(r.Context(),
		`DELETE FROM deal_participants WHERE deal_id = $1 AND user_id = $2`,
		dealID, participantID,
	)

	respond(w, http.StatusOK, map[string]string{"status": "ok"})
}
