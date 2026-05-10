package handlers

import (
	"encoding/json"
	"net/http"

	"realtourflow/internal/middleware"
)

// PatchProfile — PATCH /me/profile — updates name and/or phone in the users table.
func (h *Handler) PatchProfile(w http.ResponseWriter, r *http.Request) {
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

	var req struct {
		Name  *string `json:"name"`
		Phone *string `json:"phone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name != nil {
		_, _ = h.db.ExecContext(r.Context(), `UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2`, *req.Name, userID)
	}
	if req.Phone != nil {
		_, _ = h.db.ExecContext(r.Context(), `UPDATE users SET phone = $1, updated_at = NOW() WHERE id = $2`, *req.Phone, userID)
	}

	respond(w, http.StatusOK, map[string]bool{"ok": true})
}

// GetSettings — GET /me/settings — returns user's JSONB settings blob.
func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
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

	var raw []byte
	err = h.db.QueryRowContext(r.Context(), `
		SELECT settings FROM user_settings WHERE user_id = $1
	`, userID).Scan(&raw)
	if err != nil {
		// No row yet — return empty object
		respond(w, http.StatusOK, map[string]interface{}{})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

// PutSettings — PUT /me/settings — replaces the full settings JSONB blob.
func (h *Handler) PutSettings(w http.ResponseWriter, r *http.Request) {
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

	var payload json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	_, err = h.db.ExecContext(r.Context(), `
		INSERT INTO user_settings (user_id, settings)
		VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE
		SET settings = EXCLUDED.settings, updated_at = NOW()
	`, userID, payload)
	if err != nil {
		http.Error(w, "failed to save settings", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusOK, map[string]bool{"ok": true})
}
