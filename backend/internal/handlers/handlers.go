package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

type Handler struct {
	db *sql.DB
}

func New(db *sql.DB) *Handler {
	return &Handler{db: db}
}

func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()

	r.Get("/health", h.Health)

	return r
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	respond(w, http.StatusOK, map[string]string{"status": "ok"})
}

func respond(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
