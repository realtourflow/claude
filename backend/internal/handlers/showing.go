package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"realtourflow/internal/middleware"
)

type showingSlot struct {
	Day  string `json:"day"`
	From string `json:"from"`
	To   string `json:"to"`
}

func (h *Handler) GetShowingAvailability(w http.ResponseWriter, r *http.Request) {
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
	dealID := chi.URLParam(r, "dealId")
	if !h.checkDealAccess(r, dealID, userID) {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	var raw []byte
	h.db.QueryRowContext(r.Context(),
		`SELECT COALESCE(showing_availability, '[]'::jsonb) FROM deals WHERE id = $1`, dealID,
	).Scan(&raw)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if raw == nil {
		w.Write([]byte("[]"))
	} else {
		w.Write(raw)
	}
}

func (h *Handler) PutShowingAvailability(w http.ResponseWriter, r *http.Request) {
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
	dealID := chi.URLParam(r, "dealId")
	if !h.checkDealAccess(r, dealID, userID) {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	var slots []showingSlot
	if err := json.NewDecoder(r.Body).Decode(&slots); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	data, _ := json.Marshal(slots)

	_, err = h.db.ExecContext(r.Context(),
		`UPDATE deals SET showing_availability = $1, updated_at = NOW() WHERE id = $2`,
		data, dealID,
	)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	respond(w, http.StatusOK, map[string]string{"status": "ok"})
}
