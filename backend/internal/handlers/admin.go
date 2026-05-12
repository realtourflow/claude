package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/lib/pq"
	"realtourflow/internal/middleware"
)

func adminOnly(r *http.Request) bool {
	for _, role := range middleware.GetRoles(r) {
		if role == "admin" {
			return true
		}
	}
	return false
}

// ─── System Config ────────────────────────────────────────────────────────────

// GetSystemConfig returns the current system config (admin only).
func (h *Handler) GetSystemConfig(w http.ResponseWriter, r *http.Request) {
	if !adminOnly(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var raw []byte
	var updatedAt time.Time
	err := h.db.QueryRowContext(r.Context(),
		`SELECT config, updated_at FROM system_config WHERE id = 1`,
	).Scan(&raw, &updatedAt)
	if err != nil {
		// Return empty config if table is freshly created and seed hasn't run
		respond(w, http.StatusOK, map[string]any{"config": map[string]any{}, "updated_at": time.Now().Format(time.RFC3339)})
		return
	}

	var cfg any
	json.Unmarshal(raw, &cfg)
	respond(w, http.StatusOK, map[string]any{"config": cfg, "updated_at": updatedAt.Format(time.RFC3339)})
}

// PutSystemConfig replaces the system config (admin only).
func (h *Handler) PutSystemConfig(w http.ResponseWriter, r *http.Request) {
	if !adminOnly(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
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
		Config json.RawMessage `json:"config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Config) == 0 {
		http.Error(w, "config is required", http.StatusBadRequest)
		return
	}

	_, err = h.db.ExecContext(r.Context(), `
		INSERT INTO system_config (id, config, updated_at, updated_by)
		VALUES (1, $1, NOW(), $2)
		ON CONFLICT (id) DO UPDATE
		SET config = EXCLUDED.config, updated_at = NOW(), updated_by = EXCLUDED.updated_by
	`, body.Config, userID)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	var raw []byte
	var updatedAt time.Time
	h.db.QueryRowContext(r.Context(), `SELECT config, updated_at FROM system_config WHERE id = 1`).Scan(&raw, &updatedAt)
	var cfg any
	json.Unmarshal(raw, &cfg)
	respond(w, http.StatusOK, map[string]any{"config": cfg, "updated_at": updatedAt.Format(time.RFC3339)})
}

// ─── Promo Codes ─────────────────────────────────────────────────────────────

type apiPromoCode struct {
	ID            string   `json:"id"`
	Code          string   `json:"code"`
	DiscountType  string   `json:"discount_type"`
	DiscountValue float64  `json:"discount_value"`
	AppliesTo     []string `json:"applies_to"`
	MaxUses       *int     `json:"max_uses"`
	UsesCount     int      `json:"uses_count"`
	ExpiresAt     *string  `json:"expires_at"`
	CreatedAt     string   `json:"created_at"`
}

// ListPromoCodes returns all promo codes (admin only).
func (h *Handler) ListPromoCodes(w http.ResponseWriter, r *http.Request) {
	if !adminOnly(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT id, code, discount_type, discount_value, applies_to, max_uses, uses_count, expires_at, created_at
		FROM promo_codes
		ORDER BY created_at DESC
	`)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	codes := []apiPromoCode{}
	for rows.Next() {
		var c apiPromoCode
		var maxUses *int
		var expiresAt *time.Time
		var createdAt time.Time
		if err := rows.Scan(&c.ID, &c.Code, &c.DiscountType, &c.DiscountValue,
			pq.Array(&c.AppliesTo), &maxUses, &c.UsesCount, &expiresAt, &createdAt); err != nil {
			continue
		}
		c.MaxUses = maxUses
		if expiresAt != nil {
			s := expiresAt.Format(time.RFC3339)
			c.ExpiresAt = &s
		}
		c.CreatedAt = createdAt.Format(time.RFC3339)
		codes = append(codes, c)
	}
	respond(w, http.StatusOK, codes)
}

// CreatePromoCode creates a new promo code (admin only).
func (h *Handler) CreatePromoCode(w http.ResponseWriter, r *http.Request) {
	if !adminOnly(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
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
		Code          string   `json:"code"`
		DiscountType  string   `json:"discount_type"`
		DiscountValue float64  `json:"discount_value"`
		AppliesTo     []string `json:"applies_to"`
		MaxUses       *int     `json:"max_uses"`
		ExpiresAt     *string  `json:"expires_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	req.Code = strings.ToUpper(strings.TrimSpace(req.Code))
	if req.Code == "" || (req.DiscountType != "pct" && req.DiscountType != "fixed") {
		http.Error(w, "code and valid discount_type required", http.StatusBadRequest)
		return
	}
	if req.AppliesTo == nil {
		req.AppliesTo = []string{}
	}

	var expiresAt *time.Time
	if req.ExpiresAt != nil {
		t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
		if err == nil {
			expiresAt = &t
		}
	}

	var c apiPromoCode
	var maxUses *int
	var dbExpiresAt *time.Time
	var createdAt time.Time
	err = h.db.QueryRowContext(r.Context(), `
		INSERT INTO promo_codes (code, discount_type, discount_value, applies_to, max_uses, expires_at, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, code, discount_type, discount_value, applies_to, max_uses, uses_count, expires_at, created_at
	`, req.Code, req.DiscountType, req.DiscountValue, pq.Array(req.AppliesTo), req.MaxUses, expiresAt, userID,
	).Scan(&c.ID, &c.Code, &c.DiscountType, &c.DiscountValue, pq.Array(&c.AppliesTo),
		&maxUses, &c.UsesCount, &dbExpiresAt, &createdAt)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			http.Error(w, "promo code already exists", http.StatusConflict)
			return
		}
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	c.MaxUses = maxUses
	if dbExpiresAt != nil {
		s := dbExpiresAt.Format(time.RFC3339)
		c.ExpiresAt = &s
	}
	c.CreatedAt = createdAt.Format(time.RFC3339)
	respond(w, http.StatusCreated, c)
}

// DeletePromoCode removes a promo code (admin only).
func (h *Handler) DeletePromoCode(w http.ResponseWriter, r *http.Request) {
	if !adminOnly(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	codeID := chi.URLParam(r, "codeId")
	res, err := h.db.ExecContext(r.Context(), `DELETE FROM promo_codes WHERE id = $1`, codeID)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
