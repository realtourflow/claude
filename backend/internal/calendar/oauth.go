// Package calendar handles per-user OAuth for Google Calendar + Microsoft Graph
// and pushing RealTourFlow deal/task events to those calendars.
package calendar

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	ProviderGoogle    = "google_calendar"
	ProviderMicrosoft = "microsoft_calendar"
)

// Token is the persisted OAuth grant for one user/provider.
type Token struct {
	UserID       string
	Provider     string
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
	Scope        string
	AccountEmail string
}

// ProviderConfig is what the OAuth handlers need from the platform config.
type ProviderConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
	// AuthURL is the consent-screen URL.
	AuthURL string
	// TokenURL is where we exchange code/refresh tokens for access tokens.
	TokenURL string
	// Scopes are requested at consent time.
	Scopes []string
	// Extra query params merged into the consent URL (e.g. access_type=offline).
	Extra map[string]string
}

// GoogleConfig returns the OAuth config for Google Calendar.
func GoogleConfig(clientID, clientSecret, redirectURL string) ProviderConfig {
	return ProviderConfig{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  redirectURL,
		AuthURL:      "https://accounts.google.com/o/oauth2/v2/auth",
		TokenURL:     "https://oauth2.googleapis.com/token",
		Scopes: []string{
			"https://www.googleapis.com/auth/calendar.events",
			"https://www.googleapis.com/auth/userinfo.email",
			"openid",
		},
		// access_type=offline is required to get a refresh token. prompt=consent
		// ensures Google reissues a refresh token even if the user previously
		// authorized the app (Google only sends the refresh token on first consent).
		Extra: map[string]string{
			"access_type":            "offline",
			"prompt":                 "consent",
			"include_granted_scopes": "true",
		},
	}
}

// MicrosoftConfig returns the OAuth config for Microsoft Graph (Calendar).
func MicrosoftConfig(clientID, clientSecret, redirectURL, tenant string) ProviderConfig {
	if tenant == "" {
		tenant = "common"
	}
	return ProviderConfig{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  redirectURL,
		AuthURL:      fmt.Sprintf("https://login.microsoftonline.com/%s/oauth2/v2.0/authorize", tenant),
		TokenURL:     fmt.Sprintf("https://login.microsoftonline.com/%s/oauth2/v2.0/token", tenant),
		Scopes: []string{
			"Calendars.ReadWrite",
			"User.Read",
			"offline_access",
		},
	}
}

// AuthCodeURL returns the redirect URL the agent should be sent to in order
// to grant calendar access. `state` is the CSRF token we'll validate on return.
func (c ProviderConfig) AuthCodeURL(state string) string {
	q := url.Values{}
	q.Set("client_id", c.ClientID)
	q.Set("redirect_uri", c.RedirectURL)
	q.Set("response_type", "code")
	q.Set("scope", strings.Join(c.Scopes, " "))
	q.Set("state", state)
	for k, v := range c.Extra {
		q.Set(k, v)
	}
	return c.AuthURL + "?" + q.Encode()
}

type rawToken struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	IDToken      string `json:"id_token"`
}

// Exchange swaps an authorization code for tokens.
func (c ProviderConfig) Exchange(ctx context.Context, code string) (*Token, error) {
	form := url.Values{}
	form.Set("client_id", c.ClientID)
	form.Set("client_secret", c.ClientSecret)
	form.Set("code", code)
	form.Set("grant_type", "authorization_code")
	form.Set("redirect_uri", c.RedirectURL)
	// Microsoft requires `scope` on token exchange as well.
	form.Set("scope", strings.Join(c.Scopes, " "))
	return c.doTokenRequest(ctx, form)
}

// Refresh exchanges a refresh token for a fresh access token. Note: Google
// returns no new refresh token on refresh — keep the old one.
func (c ProviderConfig) Refresh(ctx context.Context, refreshToken string) (*Token, error) {
	form := url.Values{}
	form.Set("client_id", c.ClientID)
	form.Set("client_secret", c.ClientSecret)
	form.Set("refresh_token", refreshToken)
	form.Set("grant_type", "refresh_token")
	form.Set("scope", strings.Join(c.Scopes, " "))
	tok, err := c.doTokenRequest(ctx, form)
	if err != nil {
		return nil, err
	}
	if tok.RefreshToken == "" {
		tok.RefreshToken = refreshToken
	}
	return tok, nil
}

func (c ProviderConfig) doTokenRequest(ctx context.Context, form url.Values) (*Token, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oauth token endpoint returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var raw rawToken
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("decode token response: %w", err)
	}
	if raw.AccessToken == "" {
		return nil, errors.New("token response missing access_token")
	}

	return &Token{
		AccessToken:  raw.AccessToken,
		RefreshToken: raw.RefreshToken,
		ExpiresAt:    time.Now().Add(time.Duration(raw.ExpiresIn) * time.Second),
		Scope:        raw.Scope,
	}, nil
}

// SaveToken upserts the token row for (user_id, provider).
func SaveToken(ctx context.Context, db *sql.DB, t *Token) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, scope, account_email)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (user_id, provider) DO UPDATE
		SET access_token  = EXCLUDED.access_token,
		    refresh_token = COALESCE(NULLIF(EXCLUDED.refresh_token, ''), oauth_tokens.refresh_token),
		    expires_at    = EXCLUDED.expires_at,
		    scope         = EXCLUDED.scope,
		    account_email = COALESCE(NULLIF(EXCLUDED.account_email, ''), oauth_tokens.account_email),
		    updated_at    = NOW()
	`, t.UserID, t.Provider, t.AccessToken, t.RefreshToken, t.ExpiresAt, t.Scope, t.AccountEmail)
	return err
}

// LoadToken fetches the stored token for (user, provider). Returns nil, nil if absent.
func LoadToken(ctx context.Context, db *sql.DB, userID, provider string) (*Token, error) {
	row := db.QueryRowContext(ctx, `
		SELECT access_token, COALESCE(refresh_token,''), expires_at, scope, COALESCE(account_email,'')
		FROM oauth_tokens WHERE user_id = $1 AND provider = $2
	`, userID, provider)
	t := &Token{UserID: userID, Provider: provider}
	err := row.Scan(&t.AccessToken, &t.RefreshToken, &t.ExpiresAt, &t.Scope, &t.AccountEmail)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return t, nil
}

// DeleteToken removes the OAuth grant for (user, provider) so the agent
// must re-consent to reconnect.
func DeleteToken(ctx context.Context, db *sql.DB, userID, provider string) error {
	_, err := db.ExecContext(ctx, `DELETE FROM oauth_tokens WHERE user_id = $1 AND provider = $2`, userID, provider)
	if err != nil {
		return err
	}
	// Also drop the event-map rows for this user/provider so reconnect starts fresh.
	_, _ = db.ExecContext(ctx, `DELETE FROM calendar_event_map WHERE user_id = $1 AND provider = $2`, userID, provider)
	return nil
}

// EnsureFresh returns a token guaranteed to have at least 60s of lifetime.
// Refreshes and persists it if needed.
func (c ProviderConfig) EnsureFresh(ctx context.Context, db *sql.DB, t *Token) (*Token, error) {
	if t == nil {
		return nil, errors.New("no token")
	}
	if time.Until(t.ExpiresAt) > 60*time.Second {
		return t, nil
	}
	if t.RefreshToken == "" {
		return nil, errors.New("token expired and no refresh token available — agent must reconnect")
	}
	fresh, err := c.Refresh(ctx, t.RefreshToken)
	if err != nil {
		return nil, err
	}
	fresh.UserID = t.UserID
	fresh.Provider = t.Provider
	fresh.AccountEmail = t.AccountEmail
	if err := SaveToken(ctx, db, fresh); err != nil {
		return nil, err
	}
	return fresh, nil
}
