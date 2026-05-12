package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"realtourflow/internal/middleware"
)

type tcContactInfo struct {
	Name   string  `json:"name"`
	Email  string  `json:"email"`
	Phone  string  `json:"phone"`
	UserID *string `json:"user_id"`
}

// GetMyTC returns the calling agent's current TC info.
func (h *Handler) GetMyTC(w http.ResponseWriter, r *http.Request) {
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

	var tcUserID sql.NullString
	var tcContactRaw []byte
	err = h.db.QueryRowContext(r.Context(),
		`SELECT tc_user_id, tc_contact FROM users WHERE id = $1`, userID,
	).Scan(&tcUserID, &tcContactRaw)
	if err != nil {
		respond(w, http.StatusInternalServerError, map[string]string{"error": "db error"})
		return
	}

	if len(tcContactRaw) == 0 {
		respond(w, http.StatusNotFound, map[string]string{"error": "no tc assigned"})
		return
	}

	var contact tcContactInfo
	if err := json.Unmarshal(tcContactRaw, &contact); err != nil {
		respond(w, http.StatusInternalServerError, map[string]string{"error": "parse error"})
		return
	}
	if tcUserID.Valid {
		contact.UserID = &tcUserID.String
	}

	respond(w, http.StatusOK, contact)
}

// PutMyTC sets the calling agent's TC. Looks up the TC by email to link their user ID if found.
func (h *Handler) PutMyTC(w http.ResponseWriter, r *http.Request) {
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

	var body struct {
		Name  string `json:"name"`
		Email string `json:"email"`
		Phone string `json:"phone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respond(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))
	if body.Name == "" || body.Email == "" {
		respond(w, http.StatusBadRequest, map[string]string{"error": "name and email required"})
		return
	}

	// Try to find a TC user by email
	var tcUserID sql.NullString
	_ = h.db.QueryRowContext(r.Context(),
		`SELECT id FROM users WHERE email = $1 AND role = 'tc'`, body.Email,
	).Scan(&tcUserID)

	contact := tcContactInfo{Name: body.Name, Email: body.Email, Phone: body.Phone}
	contactJSON, _ := json.Marshal(contact)

	var nullableTCID interface{}
	if tcUserID.Valid {
		nullableTCID = tcUserID.String
		contact.UserID = &tcUserID.String
	}

	if _, err := h.db.ExecContext(r.Context(),
		`UPDATE users SET tc_user_id = $1, tc_contact = $2 WHERE id = $3`,
		nullableTCID, contactJSON, userID,
	); err != nil {
		respond(w, http.StatusInternalServerError, map[string]string{"error": "db error"})
		return
	}

	respond(w, http.StatusOK, contact)
}

// DeleteMyTC removes the TC assignment for the calling agent.
func (h *Handler) DeleteMyTC(w http.ResponseWriter, r *http.Request) {
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

	if _, err := h.db.ExecContext(r.Context(),
		`UPDATE users SET tc_user_id = NULL, tc_contact = NULL WHERE id = $1`, userID,
	); err != nil {
		respond(w, http.StatusInternalServerError, map[string]string{"error": "db error"})
		return
	}
	respond(w, http.StatusNoContent, nil)
}

type agentForTC struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Email           string  `json:"email"`
	Phone           *string `json:"phone"`
	ActiveDealCount int     `json:"active_deal_count"`
}

// ListMyAgents returns all agents who have the calling TC assigned as their TC.
func (h *Handler) ListMyAgents(w http.ResponseWriter, r *http.Request) {
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
		SELECT
			u.id,
			u.name,
			u.email,
			u.phone,
			COUNT(d.id) FILTER (WHERE d.status = 'active') AS active_deal_count
		FROM users u
		LEFT JOIN deals d ON d.agent_id = u.id
		WHERE u.tc_user_id = $1
		GROUP BY u.id, u.name, u.email, u.phone
		ORDER BY u.name
	`, userID)
	if err != nil {
		respond(w, http.StatusInternalServerError, map[string]string{"error": "db error"})
		return
	}
	defer rows.Close()

	agents := []agentForTC{}
	for rows.Next() {
		var a agentForTC
		if err := rows.Scan(&a.ID, &a.Name, &a.Email, &a.Phone, &a.ActiveDealCount); err != nil {
			continue
		}
		agents = append(agents, a)
	}
	respond(w, http.StatusOK, agents)
}
