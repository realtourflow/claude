package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"realtourflow/internal/email"
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

	// Fire invite email — best-effort, non-blocking
	go func() {
		var agentName string
		h.db.QueryRowContext(r.Context(), `SELECT name FROM users WHERE id = $1`, agentID).Scan(&agentName)
		if agentName == "" {
			agentName = "Your agent"
		}
		roleLabel := "buyer"
		if req.Role == "seller" {
			roleLabel = "seller"
		}
		inviteURL := fmt.Sprintf("%s/join/%s", h.frontendURL, inv.Token)
		html := buildInviteEmail(req.Name, agentName, roleLabel, inviteURL)
		msg := email.Message{
			From:    "RealTour Flow <noreply@realtourflow.com>",
			To:      []string{req.Email},
			Subject: fmt.Sprintf("%s has invited you to your %s portal", agentName, roleLabel),
			HTML:    html,
		}
		if err := h.emailClient.Send(context.Background(), msg); err != nil {
			fmt.Printf("invite email failed: %v\n", err)
		}
	}()

	respond(w, http.StatusCreated, inv)
}

func buildInviteEmail(clientName, agentName, role, inviteURL string) string {
	roleLabel := "Buyer Portal"
	if role == "seller" {
		roleLabel = "Seller Portal"
	}
	return fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:0;">
<table width="100%%" bgcolor="#f8f9fa" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:40px 16px;">
<table width="560" bgcolor="#ffffff" cellpadding="0" cellspacing="0" style="border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  <tr><td bgcolor="#0f1b35" style="padding:32px 40px;">
    <p style="margin:0;color:#c9a83c;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">RealTour Flow</p>
    <h1 style="margin:8px 0 0;color:#ffffff;font-size:24px;font-weight:900;">You've been invited!</h1>
  </td></tr>
  <tr><td style="padding:32px 40px;">
    <p style="margin:0 0 16px;color:#374151;font-size:16px;">Hi %s,</p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      <strong>%s</strong> has set up your <strong>%s</strong> — your private hub to track your transaction, communicate with your agent, and stay on top of every step.
    </p>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">
      Click the button below to claim your account and get started. This link is unique to you and expires in 7 days.
    </p>
    <a href="%s" style="display:inline-block;background:#0f1b35;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;">
      Open My %s →
    </a>
    <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">
      If you weren't expecting this invitation, you can safely ignore this email.
    </p>
  </td></tr>
  <tr><td style="padding:16px 40px;border-top:1px solid #f3f4f6;">
    <p style="margin:0;color:#d1d5db;font-size:11px;">RealTour Flow · Sent on behalf of %s</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`, clientName, agentName, roleLabel, inviteURL, roleLabel, agentName)
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

	// Best-effort: advance deal intake→active_search, create task, notify agent
	var dealAgentID, currentStage string
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT agent_id::TEXT, stage FROM deals WHERE id = $1`, dealID,
	).Scan(&dealAgentID, &currentStage); err == nil {
		if currentStage == "intake" {
			if tx, err := h.db.BeginTx(r.Context(), nil); err == nil {
				_, e1 := tx.ExecContext(r.Context(),
					`UPDATE deals SET stage = 'active_search', updated_at = NOW() WHERE id = $1`, dealID)
				_, e2 := tx.ExecContext(r.Context(),
					`INSERT INTO deal_stage_history (deal_id, from_stage, to_stage, changed_by) VALUES ($1, 'intake', 'active_search', $2)`,
					dealID, user.ID)
				if e1 == nil && e2 == nil {
					_ = tx.Commit()
				} else {
					_ = tx.Rollback()
				}
			}
		}

		var taskTitle, notifBody, notifType string
		if inviteRole == "seller" {
			taskTitle = fmt.Sprintf("Call %s — just completed listing onboarding", req.Name)
			notifBody = "Call them to schedule their listing strategy call."
			notifType = "seller_onboarding"
		} else {
			taskTitle = fmt.Sprintf("Call %s — just completed onboarding", req.Name)
			notifBody = "Call them ASAP to schedule their buyer strategy call."
			notifType = "buyer_onboarding"
		}
		today := time.Now().Format("2006-01-02")
		_, _ = h.db.ExecContext(r.Context(), `
			INSERT INTO tasks (deal_id, title, priority, source, stage_context, role, due_date)
			VALUES ($1, $2, 'high', 'ai', 'intake', 'agent', $3::DATE)
		`, dealID, taskTitle, today)

		if dealAgentID != "" {
			h.createNotification(dealAgentID, taskTitle, notifBody, notifType, &dealID, nil)
		}
	}

	respond(w, http.StatusOK, user)
}
