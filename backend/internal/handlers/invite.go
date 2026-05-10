package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"realtourflow/internal/middleware"
	"realtourflow/internal/models"
)

// GetInviteRole — semi-public; called by Auth0 Post-Login Action to get role for a given email.
// Checks the users table first (returning existing role), then pending invites.
func (h *Handler) GetInviteRole(w http.ResponseWriter, r *http.Request) {
	email := r.URL.Query().Get("email")
	if email == "" {
		respond(w, http.StatusOK, map[string]string{"role": ""})
		return
	}

	var role string

	// Existing user
	err := h.db.QueryRowContext(r.Context(), `SELECT role FROM users WHERE email = $1`, email).Scan(&role)
	if err == nil {
		respond(w, http.StatusOK, map[string]string{"role": role})
		return
	}

	// Pending invite
	err = h.db.QueryRowContext(r.Context(), `
		SELECT role FROM deal_invites
		WHERE email = $1 AND claimed_at IS NULL AND expires_at > NOW()
		ORDER BY created_at DESC LIMIT 1
	`, email).Scan(&role)
	if err == nil {
		respond(w, http.StatusOK, map[string]string{"role": role})
		return
	}

	respond(w, http.StatusOK, map[string]string{"role": ""})
}

// GetInvite — public; returns invite details for the /invite/:token page.
func (h *Handler) GetInvite(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")

	type inviteDetails struct {
		Token     string `json:"token"`
		DealID    string `json:"deal_id"`
		Email     string `json:"email"`
		Name      string `json:"name"`
		Role      string `json:"role"`
		AgentName string `json:"agent_name"`
		DealTitle string `json:"deal_title"`
		ExpiresAt string `json:"expires_at"`
		Claimed   bool   `json:"claimed"`
	}

	var inv inviteDetails
	var claimedAt sql.NullTime
	var expiresAt time.Time

	err := h.db.QueryRowContext(r.Context(), `
		SELECT di.token, di.deal_id, di.email, di.name, di.role,
		       u.name  AS agent_name,
		       d.title AS deal_title,
		       di.expires_at, di.claimed_at
		FROM deal_invites di
		JOIN deals d ON d.id = di.deal_id
		JOIN users u ON u.id = di.invited_by
		WHERE di.token = $1
	`, token).Scan(
		&inv.Token, &inv.DealID, &inv.Email, &inv.Name, &inv.Role,
		&inv.AgentName, &inv.DealTitle, &expiresAt, &claimedAt,
	)
	if err != nil {
		http.Error(w, "invite not found", http.StatusNotFound)
		return
	}

	inv.ExpiresAt = expiresAt.Format(time.RFC3339)
	inv.Claimed = claimedAt.Valid

	respond(w, http.StatusOK, inv)
}

// CreateInvite — agent/admin only; creates a deal-specific client invite.
func (h *Handler) CreateInvite(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	isAgent, isAdmin := false, false
	for _, role := range middleware.GetRoles(r) {
		if role == "agent" {
			isAgent = true
		}
		if role == "admin" {
			isAdmin = true
		}
	}
	if !isAgent && !isAdmin {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	dealID := chi.URLParam(r, "dealId")

	agentID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusUnauthorized)
		return
	}

	// Verify ownership (agents can only invite to their own deals)
	if !isAdmin {
		var ownerID string
		if err := h.db.QueryRowContext(r.Context(), `SELECT agent_id FROM deals WHERE id = $1`, dealID).Scan(&ownerID); err != nil || ownerID != agentID {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
	}

	var req struct {
		Email string `json:"email"`
		Name  string `json:"name"`
		Role  string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Email == "" || req.Name == "" || (req.Role != "buyer" && req.Role != "seller") {
		http.Error(w, "email, name, and role (buyer|seller) are required", http.StatusBadRequest)
		return
	}

	type inviteRow struct {
		ID        string `json:"id"`
		DealID    string `json:"deal_id"`
		Email     string `json:"email"`
		Name      string `json:"name"`
		Role      string `json:"role"`
		Token     string `json:"token"`
		ExpiresAt string `json:"expires_at"`
	}

	var inv inviteRow
	var expiresAt time.Time
	err = h.db.QueryRowContext(r.Context(), `
		INSERT INTO deal_invites (deal_id, email, name, role, invited_by)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, deal_id, email, name, role, token::text, expires_at
	`, dealID, req.Email, req.Name, req.Role, agentID).Scan(
		&inv.ID, &inv.DealID, &inv.Email, &inv.Name, &inv.Role, &inv.Token, &expiresAt,
	)
	if err != nil {
		http.Error(w, "failed to create invite", http.StatusInternalServerError)
		return
	}
	inv.ExpiresAt = expiresAt.Format(time.RFC3339)

	respond(w, http.StatusCreated, inv)
}

// ClaimInvite — authenticated (JWT required, role claim not required).
// Creates/upserts the user from the invite's role and links them as a participant.
func (h *Handler) ClaimInvite(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	auth0ID := claims.RegisteredClaims.Subject
	token := chi.URLParam(r, "token")

	var req struct {
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	var inviteID, dealID, inviteRole string
	var claimedAt sql.NullTime
	var expiresAt time.Time

	err := h.db.QueryRowContext(r.Context(), `
		SELECT id, deal_id, role, claimed_at, expires_at
		FROM deal_invites
		WHERE token = $1 AND email = $2
	`, token, req.Email).Scan(&inviteID, &dealID, &inviteRole, &claimedAt, &expiresAt)
	if err != nil {
		http.Error(w, "invite not found", http.StatusNotFound)
		return
	}
	if claimedAt.Valid {
		http.Error(w, "invite already claimed", http.StatusConflict)
		return
	}
	if expiresAt.Before(time.Now()) {
		http.Error(w, "invite expired", http.StatusGone)
		return
	}

	user, err := upsertUser(r.Context(), h.db, auth0ID, req.Email, req.Name, models.UserRole(inviteRole))
	if err != nil {
		http.Error(w, "failed to create user", http.StatusInternalServerError)
		return
	}

	_, err = h.db.ExecContext(r.Context(), `
		UPDATE deal_invites SET claimed_at = NOW(), claimed_by = $1 WHERE id = $2
	`, user.ID, inviteID)
	if err != nil {
		http.Error(w, "failed to claim invite", http.StatusInternalServerError)
		return
	}

	// Add to deal_participants (ON CONFLICT DO NOTHING if already a participant)
	_, _ = h.db.ExecContext(r.Context(), `
		INSERT INTO deal_participants (deal_id, user_id, role)
		VALUES ($1, $2, $3)
		ON CONFLICT DO NOTHING
	`, dealID, user.ID, inviteRole)

	respond(w, http.StatusOK, user)
}
