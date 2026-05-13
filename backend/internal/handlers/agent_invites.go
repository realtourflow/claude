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

type agentInviteRow struct {
	ID        string  `json:"id"`
	Email     string  `json:"email"`
	Name      string  `json:"name"`
	Token     string  `json:"token"`
	InvitedBy string  `json:"invited_by"`
	Claimed   bool    `json:"claimed"`
	ExpiresAt string  `json:"expires_at"`
	CreatedAt string  `json:"created_at"`
}

// ListAgentInvites — admin only; returns all pending + recent agent invites.
func (h *Handler) ListAgentInvites(w http.ResponseWriter, r *http.Request) {
	isAdmin := false
	for _, role := range middleware.GetRoles(r) {
		if role == "admin" {
			isAdmin = true
			break
		}
	}
	if !isAdmin {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT id, email, name, token::TEXT, invited_by::TEXT, claimed_at, expires_at, created_at
		FROM agent_invites
		ORDER BY created_at DESC
		LIMIT 100
	`)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var list []agentInviteRow
	for rows.Next() {
		var inv agentInviteRow
		var claimedAt sql.NullTime
		var expiresAt, createdAt time.Time
		if err := rows.Scan(&inv.ID, &inv.Email, &inv.Name, &inv.Token, &inv.InvitedBy,
			&claimedAt, &expiresAt, &createdAt); err != nil {
			continue
		}
		inv.Claimed = claimedAt.Valid
		inv.ExpiresAt = expiresAt.Format(time.RFC3339)
		inv.CreatedAt = createdAt.Format(time.RFC3339)
		list = append(list, inv)
	}
	if list == nil {
		list = []agentInviteRow{}
	}
	respond(w, http.StatusOK, list)
}

// DeleteAgentInvite — admin only; revokes an unclaimed invite.
func (h *Handler) DeleteAgentInvite(w http.ResponseWriter, r *http.Request) {
	isAdmin := false
	for _, role := range middleware.GetRoles(r) {
		if role == "admin" {
			isAdmin = true
			break
		}
	}
	if !isAdmin {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	inviteID := chi.URLParam(r, "inviteId")
	res, err := h.db.ExecContext(r.Context(),
		`DELETE FROM agent_invites WHERE id = $1 AND claimed_at IS NULL`, inviteID)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		http.Error(w, "invite not found or already claimed", http.StatusNotFound)
		return
	}
	respond(w, http.StatusOK, map[string]bool{"ok": true})
}

// GetAgentInvite — public; validates an agent invite token.
func (h *Handler) GetAgentInvite(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")

	var inv agentInviteRow
	var claimedAt sql.NullTime
	var expiresAt, createdAt time.Time

	err := h.db.QueryRowContext(r.Context(), `
		SELECT ai.id, ai.email, ai.name, ai.token::TEXT, ai.invited_by::TEXT,
		       ai.claimed_at, ai.expires_at, ai.created_at
		FROM agent_invites ai
		WHERE ai.token = $1
	`, token).Scan(
		&inv.ID, &inv.Email, &inv.Name, &inv.Token, &inv.InvitedBy,
		&claimedAt, &expiresAt, &createdAt,
	)
	if err != nil {
		http.Error(w, "invite not found", http.StatusNotFound)
		return
	}

	inv.Claimed = claimedAt.Valid
	inv.ExpiresAt = expiresAt.Format(time.RFC3339)
	inv.CreatedAt = createdAt.Format(time.RFC3339)

	if expiresAt.Before(time.Now()) && !claimedAt.Valid {
		http.Error(w, "invite expired", http.StatusGone)
		return
	}

	respond(w, http.StatusOK, inv)
}

// CreateAgentInvite — admin only; creates an invite and fires a signup email.
func (h *Handler) CreateAgentInvite(w http.ResponseWriter, r *http.Request) {
	isAdmin := false
	for _, role := range middleware.GetRoles(r) {
		if role == "admin" {
			isAdmin = true
			break
		}
	}
	if !isAdmin {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	claims := middleware.GetClaims(r)
	adminID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusUnauthorized)
		return
	}

	var req struct {
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" {
		http.Error(w, "email is required", http.StatusBadRequest)
		return
	}

	var inv agentInviteRow
	var expiresAt, createdAt time.Time
	err = h.db.QueryRowContext(r.Context(), `
		INSERT INTO agent_invites (email, name, invited_by)
		VALUES ($1, $2, $3)
		RETURNING id, email, name, token::TEXT, invited_by::TEXT, expires_at, created_at
	`, req.Email, req.Name, adminID).Scan(
		&inv.ID, &inv.Email, &inv.Name, &inv.Token, &inv.InvitedBy, &expiresAt, &createdAt,
	)
	if err != nil {
		http.Error(w, "failed to create invite", http.StatusInternalServerError)
		return
	}
	inv.ExpiresAt = expiresAt.Format(time.RFC3339)
	inv.CreatedAt = createdAt.Format(time.RFC3339)

	go func() {
		inviteURL := fmt.Sprintf("%s/agent-signup/%s", h.frontendURL, inv.Token)
		html := buildAgentInviteEmail(req.Name, inviteURL)
		msg := email.Message{
			From:    "RealTour Flow <noreply@realtourflow.com>",
			To:      []string{req.Email},
			Subject: "You're invited to join RealTour Flow as an agent",
			HTML:    html,
		}
		if err := h.emailClient.Send(context.Background(), msg); err != nil {
			fmt.Printf("agent invite email failed: %v\n", err)
		}
	}()

	respond(w, http.StatusCreated, inv)
}

// ClaimAgentInvite — JWT required (no role needed); creates the agent user and marks the invite claimed.
func (h *Handler) ClaimAgentInvite(w http.ResponseWriter, r *http.Request) {
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

	var inviteID, inviteEmail string
	var claimedAt sql.NullTime
	var expiresAt time.Time

	err := h.db.QueryRowContext(r.Context(), `
		SELECT id, email, claimed_at, expires_at
		FROM agent_invites
		WHERE token = $1
	`, token).Scan(&inviteID, &inviteEmail, &claimedAt, &expiresAt)
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

	// Use invited email if the request didn't supply one
	claimEmail := req.Email
	if claimEmail == "" {
		claimEmail = inviteEmail
	}
	claimName := req.Name
	if claimName == "" {
		claimName = inviteEmail
	}

	user, err := upsertUser(r.Context(), h.db, auth0ID, claimEmail, claimName, models.UserRole("agent"))
	if err != nil {
		http.Error(w, "failed to create user", http.StatusInternalServerError)
		return
	}

	_, _ = h.db.ExecContext(r.Context(), `
		UPDATE agent_invites SET claimed_at = NOW(), claimed_by = $1 WHERE id = $2
	`, user.ID, inviteID)

	respond(w, http.StatusOK, user)
}

func buildAgentInviteEmail(agentName, inviteURL string) string {
	greeting := "Hi there,"
	if agentName != "" {
		greeting = fmt.Sprintf("Hi %s,", agentName)
	}
	return fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:0;">
<table width="100%%" bgcolor="#f8f9fa" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:40px 16px;">
<table width="560" bgcolor="#ffffff" cellpadding="0" cellspacing="0" style="border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  <tr><td bgcolor="#0f1b35" style="padding:32px 40px;">
    <p style="margin:0;color:#c9a83c;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">RealTour Flow</p>
    <h1 style="margin:8px 0 0;color:#ffffff;font-size:24px;font-weight:900;">You're invited to join as an agent.</h1>
  </td></tr>
  <tr><td style="padding:32px 40px;">
    <p style="margin:0 0 16px;color:#374151;font-size:16px;">%s</p>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
      You've been invited to set up your agent account on <strong>RealTour Flow</strong> — the deal operating system built for real estate professionals.
    </p>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">
      Click the button below to create your account and complete onboarding. The whole setup takes about 5 minutes. This link expires in 7 days.
    </p>
    <a href="%s" style="display:inline-block;background:#0f1b35;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;">
      Set Up My Agent Account →
    </a>
    <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">
      If you weren't expecting this invitation, you can safely ignore this email.
    </p>
  </td></tr>
  <tr><td style="padding:16px 40px;border-top:1px solid #f3f4f6;">
    <p style="margin:0;color:#d1d5db;font-size:11px;">RealTour Flow · Built for real estate agents</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`, greeting, inviteURL)
}
