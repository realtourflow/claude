package docusign

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type Client struct {
	integrationKey string
	userID         string
	accountID      string
	privateKey     *rsa.PrivateKey
	baseURL        string // e.g. https://demo.docusign.net
	authURL        string // e.g. https://account-d.docusign.com

	mu          sync.Mutex
	accessToken string
	tokenExpiry time.Time

	http *http.Client
}

type Signer struct {
	Email string
	Name  string
}

// New creates a DocuSign client. Returns a disabled client (not an error) if credentials are empty.
func New(integrationKey, userID, accountID, privateKeyPEM, baseURL string) (*Client, error) {
	c := &Client{
		integrationKey: integrationKey,
		userID:         userID,
		accountID:      accountID,
		baseURL:        strings.TrimRight(baseURL, "/"),
		http:           &http.Client{Timeout: 30 * time.Second},
	}

	if integrationKey == "" {
		return c, nil
	}

	// Normalize newlines in private key (env vars may encode them as \n)
	keyPEM := strings.ReplaceAll(privateKeyPEM, `\n`, "\n")
	block, _ := pem.Decode([]byte(keyPEM))
	if block == nil {
		return nil, fmt.Errorf("docusign: failed to decode PEM private key")
	}
	key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("docusign: failed to parse RSA private key: %w", err)
	}
	c.privateKey = key

	if strings.Contains(baseURL, "demo") {
		c.authURL = "https://account-d.docusign.com"
	} else {
		c.authURL = "https://account.docusign.com"
	}

	return c, nil
}

func (c *Client) Enabled() bool {
	return c.integrationKey != "" && c.privateKey != nil
}

func (c *Client) getToken() (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if time.Now().Before(c.tokenExpiry) {
		return c.accessToken, nil
	}

	now := time.Now().Unix()
	aud := strings.TrimPrefix(strings.TrimPrefix(c.authURL, "https://"), "http://")

	headerJSON, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT"})
	payloadJSON, _ := json.Marshal(map[string]interface{}{
		"iss":   c.integrationKey,
		"sub":   c.userID,
		"aud":   aud,
		"iat":   now,
		"exp":   now + 3600,
		"scope": "signature impersonation",
	})

	h := base64.RawURLEncoding.EncodeToString(headerJSON)
	p := base64.RawURLEncoding.EncodeToString(payloadJSON)
	unsigned := h + "." + p

	hash := sha256.Sum256([]byte(unsigned))
	sig, err := rsa.SignPKCS1v15(rand.Reader, c.privateKey, crypto.SHA256, hash[:])
	if err != nil {
		return "", fmt.Errorf("sign JWT: %w", err)
	}
	jwtToken := unsigned + "." + base64.RawURLEncoding.EncodeToString(sig)

	resp, err := c.http.PostForm(c.authURL+"/oauth/token", url.Values{
		"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"},
		"assertion":  {jwtToken},
	})
	if err != nil {
		return "", fmt.Errorf("token request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("token error %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode token: %w", err)
	}

	c.accessToken = result.AccessToken
	c.tokenExpiry = time.Now().Add(time.Duration(result.ExpiresIn-60) * time.Second)
	return c.accessToken, nil
}

// CreateEnvelope sends a document to one or more signers and returns the envelope ID.
func (c *Client) CreateEnvelope(docName string, docBytes []byte, signers []Signer) (string, error) {
	if !c.Enabled() {
		return "", fmt.Errorf("DocuSign not configured")
	}

	token, err := c.getToken()
	if err != nil {
		return "", err
	}

	ext := "pdf"
	if idx := strings.LastIndex(docName, "."); idx >= 0 {
		ext = strings.ToLower(docName[idx+1:])
	}

	type signHereTab struct {
		DocumentID  string `json:"documentId"`
		PageNumber  string `json:"pageNumber"`
		XPosition   string `json:"xPosition"`
		YPosition   string `json:"yPosition"`
		AnchorUnits string `json:"anchorUnits,omitempty"`
	}
	type signerPayload struct {
		Email        string                     `json:"email"`
		Name         string                     `json:"name"`
		RecipientID  string                     `json:"recipientId"`
		RoutingOrder string                     `json:"routingOrder"`
		Tabs         map[string][]signHereTab   `json:"tabs"`
	}

	var recipients []signerPayload
	for i, s := range signers {
		id := fmt.Sprintf("%d", i+1)
		recipients = append(recipients, signerPayload{
			Email:        s.Email,
			Name:         s.Name,
			RecipientID:  id,
			RoutingOrder: id,
			Tabs: map[string][]signHereTab{
				"signHereTabs": {{
					DocumentID: "1",
					PageNumber: "1",
					XPosition:  "100",
					YPosition:  "680",
				}},
			},
		})
	}

	envelope := map[string]interface{}{
		"emailSubject": "Please sign: " + docName,
		"documents": []map[string]string{{
			"documentBase64": base64.StdEncoding.EncodeToString(docBytes),
			"name":           docName,
			"fileExtension":  ext,
			"documentId":     "1",
		}},
		"recipients": map[string]interface{}{
			"signers": recipients,
		},
		"status": "sent",
	}

	body, _ := json.Marshal(envelope)
	apiURL := fmt.Sprintf("%s/restapi/v2.1/accounts/%s/envelopes", c.baseURL, c.accountID)

	req, err := http.NewRequest("POST", apiURL, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("create envelope %d: %s", resp.StatusCode, string(b))
	}

	var result struct {
		EnvelopeID string `json:"envelopeId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	return result.EnvelopeID, nil
}

// GetEnvelopeStatus polls DocuSign for the current envelope status.
func (c *Client) GetEnvelopeStatus(envelopeID string) (string, error) {
	if !c.Enabled() {
		return "", fmt.Errorf("DocuSign not configured")
	}

	token, err := c.getToken()
	if err != nil {
		return "", err
	}

	apiURL := fmt.Sprintf("%s/restapi/v2.1/accounts/%s/envelopes/%s", c.baseURL, c.accountID, envelopeID)
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("get envelope status %d: %s", resp.StatusCode, string(b))
	}

	var result struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	return result.Status, nil
}
