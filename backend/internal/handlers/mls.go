package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"realtourflow/internal/middleware"
	"realtourflow/internal/simplyrets"
)

// GetMyMLS — GET /me/mls — returns whether the authenticated user has MLS credentials saved.
func (h *Handler) GetMyMLS(w http.ResponseWriter, r *http.Request) {
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

	var mlsKey string
	_ = h.db.QueryRowContext(r.Context(),
		`SELECT COALESCE(mls_key, '') FROM users WHERE id = $1`, userID,
	).Scan(&mlsKey)

	respond(w, http.StatusOK, map[string]bool{"connected": mlsKey != ""})
}

// PatchMyMLS — PATCH /me/mls — saves or clears MLS credentials.
func (h *Handler) PatchMyMLS(w http.ResponseWriter, r *http.Request) {
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

	var req struct {
		Key    string `json:"key"`
		Secret string `json:"secret"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	key := strings.TrimSpace(req.Key)
	secret := strings.TrimSpace(req.Secret)

	// Test credentials before saving (unless clearing)
	if key != "" && secret != "" {
		client := simplyrets.New(key, secret)
		_, testErr := client.SearchListings(simplyrets.SearchParams{Limit: 1})
		if testErr != nil {
			http.Error(w, "MLS credentials are invalid: "+testErr.Error(), http.StatusBadRequest)
			return
		}
	}

	_, err = h.db.ExecContext(r.Context(),
		`UPDATE users SET mls_key = NULLIF($1, ''), mls_secret = NULLIF($2, ''), updated_at = NOW() WHERE id = $3`,
		key, secret, userID,
	)
	if err != nil {
		http.Error(w, "failed to save", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusOK, map[string]bool{"ok": true, "connected": key != ""})
}

// SearchListings — GET /deals/:dealId/listings/search — proxies to SimplyRETS using the agent's credentials.
func (h *Handler) SearchListings(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	callerID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	dealID := chi.URLParam(r, "dealId")

	// Find agent for this deal — caller may be agent or participant
	var agentID string
	err = h.db.QueryRowContext(r.Context(), `
		SELECT agent_id FROM deals
		WHERE id = $1
		  AND (agent_id = $2 OR EXISTS(
			SELECT 1 FROM deal_participants WHERE deal_id = $1 AND user_id = $2
		  ))
	`, dealID, callerID).Scan(&agentID)
	if err != nil {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	var mlsKey, mlsSecret string
	_ = h.db.QueryRowContext(r.Context(),
		`SELECT COALESCE(mls_key,''), COALESCE(mls_secret,'') FROM users WHERE id = $1`, agentID,
	).Scan(&mlsKey, &mlsSecret)

	if mlsKey == "" {
		http.Error(w, "agent has not connected MLS", http.StatusServiceUnavailable)
		return
	}

	// Parse search params from query string
	q := r.URL.Query()
	params := simplyrets.SearchParams{Limit: 12}

	if v := q.Get("minprice"); v != "" {
		params.MinPrice, _ = strconv.Atoi(v)
	}
	if v := q.Get("maxprice"); v != "" {
		params.MaxPrice, _ = strconv.Atoi(v)
	}
	if v := q.Get("minbeds"); v != "" {
		params.MinBeds, _ = strconv.Atoi(v)
	}
	if cities := q["cities"]; len(cities) > 0 {
		params.Cities = cities
	} else if v := q.Get("city"); v != "" {
		params.Cities = []string{v}
	}
	if v := q.Get("status"); v != "" {
		params.Status = v
	}
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 50 {
			params.Limit = n
		}
	}

	client := simplyrets.New(mlsKey, mlsSecret)
	listings, err := client.SearchListings(params)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	respond(w, http.StatusOK, listings)
}
