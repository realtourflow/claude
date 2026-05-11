package arive

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"
	"time"
)

// TrackerStatus represents the current state of one ARIVE loan tracker.
type TrackerStatus struct {
	Status string `json:"status"`
}

// LoanTracker is one item in the loanTrackers array returned by Get Loan Details.
type LoanTracker struct {
	Name                 string        `json:"name"`
	CurrentTrackerStatus TrackerStatus `json:"currentTrackerStatus"`
}

// LoanStatus is the overall loan status object from ARIVE.
type LoanStatus struct {
	Status string `json:"status"`
}

// Loan holds the ARIVE loan fields we care about.
type Loan struct {
	ID                string          `json:"id"`
	CrmReferenceID    string          `json:"crmReferenceId"`
	CurrentLoanStatus LoanStatus      `json:"currentLoanStatus"`
	LoanTrackers      []LoanTracker   `json:"loanTrackers"`
	KeyDates          json.RawMessage `json:"keyDates"`
}

// WebhookPayload is the body ARIVE sends to our webhook endpoint.
type WebhookPayload struct {
	LoanID string `json:"loanId"`
	ID     string `json:"id"`
	Event  string `json:"event"`
}

func (p *WebhookPayload) ResolvedLoanID() string {
	if p.LoanID != "" {
		return p.LoanID
	}
	return p.ID
}

// Client calls the ARIVE API using OAuth2 client_credentials.
type Client struct {
	apiURL       string
	apiKey       string
	clientID     string
	clientSecret string
	httpClient   *http.Client

	mu          sync.Mutex
	accessToken string
	tokenExpiry time.Time
}

func New(apiURL, apiKey, clientID, clientSecret string) *Client {
	return &Client{
		apiURL:       apiURL,
		apiKey:       apiKey,
		clientID:     clientID,
		clientSecret: clientSecret,
		httpClient:   &http.Client{Timeout: 15 * time.Second},
	}
}

// Enabled returns false when no API credentials are configured.
func (c *Client) Enabled() bool {
	return c.apiURL != "" && c.apiKey != "" && c.clientID != ""
}

// token returns a valid Bearer token, fetching a new one if needed.
func (c *Client) token(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.accessToken != "" && time.Now().Before(c.tokenExpiry) {
		return c.accessToken, nil
	}

	payload := map[string]string{
		"ClientId":     c.clientID,
		"ClientSecret": c.clientSecret,
	}
	b, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiURL+"/api/auth/token", bytes.NewReader(b))
	if err != nil {
		return "", fmt.Errorf("build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-KEY", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetch arive token: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("arive token: status %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("decode token response: %w", err)
	}

	tok := result.Token
	if tok == "" {
		tok = result.AccessToken
	}
	if tok == "" {
		return "", fmt.Errorf("arive token response contained no token field")
	}

	expiry := 3500 * time.Second
	if result.ExpiresIn > 0 {
		expiry = time.Duration(result.ExpiresIn-60) * time.Second
	}

	c.accessToken = tok
	c.tokenExpiry = time.Now().Add(expiry)
	log.Println("arive: access token refreshed")
	return tok, nil
}

func (c *Client) do(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal request: %w", err)
		}
		bodyReader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.apiURL+path, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-KEY", c.apiKey)

	tok, err := c.token(ctx)
	if err != nil {
		return nil, fmt.Errorf("get token: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+tok)

	return c.httpClient.Do(req)
}

// GetLoan fetches a loan by ARIVE loan ID.
func (c *Client) GetLoan(ctx context.Context, loanID string) (*Loan, error) {
	resp, err := c.do(ctx, http.MethodGet, "/api/loans/"+loanID, nil)
	if err != nil {
		return nil, fmt.Errorf("get loan: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("arive get loan %s: status %d: %s", loanID, resp.StatusCode, string(body))
	}

	var loan Loan
	if err := json.NewDecoder(resp.Body).Decode(&loan); err != nil {
		return nil, fmt.Errorf("decode loan: %w", err)
	}
	return &loan, nil
}

// SubscribeToEvent registers a webhook URL for a specific ARIVE event type.
func (c *Client) SubscribeToEvent(ctx context.Context, webhookURL, event string) error {
	payload := map[string]string{
		"WebhookUrl": webhookURL,
		"Event":      event,
	}

	resp, err := c.do(ctx, http.MethodPost, "/api/hooks/subscribe", payload)
	if err != nil {
		return fmt.Errorf("subscribe to %s: %w", event, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("subscribe to %s: status %d: %s", event, resp.StatusCode, string(body))
	}
	return nil
}

// RegisterWebhooks subscribes to all ARIVE events relevant to RealTourFlow.
// Safe to call repeatedly — ARIVE deduplicates by URL+event.
func (c *Client) RegisterWebhooks(ctx context.Context, webhookURL string) error {
	events := []string{
		"LOAN_TRACKERS_UPDATED",
		"LOAN_DATE_CHANGED",
		"LOAN_STAGE_CHANGED",
		"LOAN_CREATED",
	}
	for _, e := range events {
		if err := c.SubscribeToEvent(ctx, webhookURL, e); err != nil {
			return err
		}
	}
	return nil
}
