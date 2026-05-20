package handlers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"realtourflow/internal/calendar"
	"realtourflow/internal/middleware"
)

// ─── Status endpoint ────────────────────────────────────────────────────────────

type integrationStatus struct {
	Configured   bool   `json:"configured"`
	Connected    bool   `json:"connected"`
	Scope        string `json:"scope"` // 'platform' or 'user'
	AccountEmail string `json:"account_email,omitempty"`
}

type integrationsResponse struct {
	ARIVE             integrationStatus `json:"arive"`
	DocuSign          integrationStatus `json:"docusign"`
	Stripe            integrationStatus `json:"stripe"`
	GoogleCalendar    integrationStatus `json:"google_calendar"`
	MicrosoftCalendar integrationStatus `json:"microsoft_calendar"`
}

// GetIntegrations reports the live status of every integration so the
// Settings UI can show real "Enabled / Connect / Not configured" badges
// instead of fake "coming soon" copy.
func (h *Handler) GetIntegrations(w http.ResponseWriter, r *http.Request) {
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

	resp := integrationsResponse{
		ARIVE: integrationStatus{
			Configured: h.ariveClient != nil && h.ariveClient.Enabled(),
			Connected:  h.ariveClient != nil && h.ariveClient.Enabled(),
			Scope:      "platform",
		},
		DocuSign: integrationStatus{
			Configured: h.docusignClient != nil && h.docusignClient.Enabled(),
			Connected:  h.docusignClient != nil && h.docusignClient.Enabled(),
			Scope:      "platform",
		},
		Stripe: integrationStatus{
			Configured: h.stripeKey != "",
			Connected:  h.stripeKey != "",
			Scope:      "platform",
		},
		GoogleCalendar: integrationStatus{
			Configured: h.googleOAuth.ClientID != "",
			Scope:      "user",
		},
		MicrosoftCalendar: integrationStatus{
			Configured: h.microsoftOAuth.ClientID != "",
			Scope:      "user",
		},
	}

	if tok, err := calendar.LoadToken(r.Context(), h.db, userID, calendar.ProviderGoogle); err == nil && tok != nil {
		resp.GoogleCalendar.Connected = true
		resp.GoogleCalendar.AccountEmail = tok.AccountEmail
	}
	if tok, err := calendar.LoadToken(r.Context(), h.db, userID, calendar.ProviderMicrosoft); err == nil && tok != nil {
		resp.MicrosoftCalendar.Connected = true
		resp.MicrosoftCalendar.AccountEmail = tok.AccountEmail
	}

	respond(w, http.StatusOK, resp)
}

// ─── OAuth state store ──────────────────────────────────────────────────────────
//
// We need a short-lived CSRF state so when Google/Microsoft redirect the user
// back to us, we can verify the request originated from a legitimate /start
// call. Storing state in memory is fine for a single-instance API; if you
// horizontally scale, move this to Redis or a `oauth_states` table.

type oauthStateEntry struct {
	UserID    string
	Provider  string
	ExpiresAt time.Time
}

var (
	oauthStates   = map[string]oauthStateEntry{}
	oauthStatesMu sync.Mutex
)

func newOAuthState(userID, provider string) string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	state := base64.RawURLEncoding.EncodeToString(b)
	oauthStatesMu.Lock()
	defer oauthStatesMu.Unlock()
	oauthStates[state] = oauthStateEntry{UserID: userID, Provider: provider, ExpiresAt: time.Now().Add(10 * time.Minute)}
	// Opportunistic cleanup of expired states.
	for k, v := range oauthStates {
		if time.Now().After(v.ExpiresAt) {
			delete(oauthStates, k)
		}
	}
	return state
}

func consumeOAuthState(state string) (oauthStateEntry, bool) {
	oauthStatesMu.Lock()
	defer oauthStatesMu.Unlock()
	entry, ok := oauthStates[state]
	if !ok {
		return oauthStateEntry{}, false
	}
	delete(oauthStates, state)
	if time.Now().After(entry.ExpiresAt) {
		return oauthStateEntry{}, false
	}
	return entry, true
}

// ─── Google Calendar ────────────────────────────────────────────────────────────

// StartGoogleCalendarOAuth — GET /me/integrations/google-calendar/start
// Returns the consent URL the agent should navigate to. We return JSON
// (rather than a 302) because the frontend calls this with a Bearer token
// that can't survive a cross-origin redirect to accounts.google.com.
func (h *Handler) StartGoogleCalendarOAuth(w http.ResponseWriter, r *http.Request) {
	if h.googleOAuth.ClientID == "" {
		http.Error(w, "google calendar oauth not configured on this server", http.StatusServiceUnavailable)
		return
	}
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
	state := newOAuthState(userID, calendar.ProviderGoogle)
	respond(w, http.StatusOK, map[string]string{"authorize_url": h.googleOAuth.AuthCodeURL(state)})
}

// GoogleCalendarCallback — GET /integrations/google-calendar/callback (PUBLIC)
// Google redirects the agent here with ?code=...&state=...
func (h *Handler) GoogleCalendarCallback(w http.ResponseWriter, r *http.Request) {
	h.oauthCallback(w, r, h.googleOAuth, calendar.ProviderGoogle, googleAccountEmail)
}

// StartMicrosoftCalendarOAuth — GET /me/integrations/microsoft-calendar/start
// Returns the consent URL as JSON (see StartGoogleCalendarOAuth for why).
func (h *Handler) StartMicrosoftCalendarOAuth(w http.ResponseWriter, r *http.Request) {
	if h.microsoftOAuth.ClientID == "" {
		http.Error(w, "microsoft calendar oauth not configured on this server", http.StatusServiceUnavailable)
		return
	}
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
	state := newOAuthState(userID, calendar.ProviderMicrosoft)
	respond(w, http.StatusOK, map[string]string{"authorize_url": h.microsoftOAuth.AuthCodeURL(state)})
}

// MicrosoftCalendarCallback — GET /integrations/microsoft-calendar/callback (PUBLIC)
func (h *Handler) MicrosoftCalendarCallback(w http.ResponseWriter, r *http.Request) {
	h.oauthCallback(w, r, h.microsoftOAuth, calendar.ProviderMicrosoft, microsoftAccountEmail)
}

// oauthCallback validates state, exchanges the code for tokens, persists them,
// then bounces the user back to the frontend Settings → Integrations tab.
func (h *Handler) oauthCallback(
	w http.ResponseWriter, r *http.Request,
	cfg calendar.ProviderConfig, provider string,
	emailLookup func(ctx context.Context, accessToken string) string,
) {
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	authErr := r.URL.Query().Get("error")

	frontendRedirect := h.frontendURL + "/agent/settings?integrations="

	if authErr != "" {
		http.Redirect(w, r, frontendRedirect+provider+"_error&reason="+authErr, http.StatusFound)
		return
	}

	entry, ok := consumeOAuthState(state)
	if !ok || entry.Provider != provider {
		http.Redirect(w, r, frontendRedirect+provider+"_error&reason=invalid_state", http.StatusFound)
		return
	}
	if code == "" {
		http.Redirect(w, r, frontendRedirect+provider+"_error&reason=missing_code", http.StatusFound)
		return
	}

	tok, err := cfg.Exchange(r.Context(), code)
	if err != nil {
		http.Redirect(w, r, frontendRedirect+provider+"_error&reason=exchange_failed", http.StatusFound)
		return
	}
	tok.UserID = entry.UserID
	tok.Provider = provider

	if emailLookup != nil {
		tok.AccountEmail = emailLookup(r.Context(), tok.AccessToken)
	}

	if err := calendar.SaveToken(r.Context(), h.db, tok); err != nil {
		http.Redirect(w, r, frontendRedirect+provider+"_error&reason=save_failed", http.StatusFound)
		return
	}
	http.Redirect(w, r, frontendRedirect+provider+"_connected", http.StatusFound)
}

// DisconnectGoogleCalendar — DELETE /me/integrations/google-calendar
func (h *Handler) DisconnectGoogleCalendar(w http.ResponseWriter, r *http.Request) {
	h.disconnectProvider(w, r, calendar.ProviderGoogle)
}

// DisconnectMicrosoftCalendar — DELETE /me/integrations/microsoft-calendar
func (h *Handler) DisconnectMicrosoftCalendar(w http.ResponseWriter, r *http.Request) {
	h.disconnectProvider(w, r, calendar.ProviderMicrosoft)
}

func (h *Handler) disconnectProvider(w http.ResponseWriter, r *http.Request, provider string) {
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
	if err := calendar.DeleteToken(r.Context(), h.db, userID, provider); err != nil {
		http.Error(w, "failed to disconnect", http.StatusInternalServerError)
		return
	}
	respond(w, http.StatusOK, map[string]bool{"ok": true})
}

// ─── Account-email lookup helpers ───────────────────────────────────────────────

// googleAccountEmail calls /userinfo to find out which Google account just
// granted consent so we can show it in the Settings UI.
func googleAccountEmail(ctx context.Context, accessToken string) string {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.googleapis.com/oauth2/v2/userinfo", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var out struct {
		Email string `json:"email"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return strings.ToLower(out.Email)
}

// microsoftAccountEmail calls Microsoft Graph /me to find out which mailbox
// the agent connected so we can show it in the Settings UI.
func microsoftAccountEmail(ctx context.Context, accessToken string) string {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://graph.microsoft.com/v1.0/me", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var out struct {
		Mail              string `json:"mail"`
		UserPrincipalName string `json:"userPrincipalName"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	email := out.Mail
	if email == "" {
		email = out.UserPrincipalName
	}
	return strings.ToLower(email)
}
