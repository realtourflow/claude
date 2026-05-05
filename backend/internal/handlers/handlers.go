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

func (h *Handler) Routes(auth func(http.Handler) http.Handler) http.Handler {
	r := chi.NewRouter()

	r.Get("/health", h.Health)

	r.Group(func(r chi.Router) {
		r.Use(auth)
		r.Post("/users/sync", h.SyncUser)

		r.Get("/deals", h.ListDeals)
		r.Post("/deals", h.CreateDeal)
		r.Get("/deals/{dealId}", h.GetDeal)
		r.Patch("/deals/{dealId}/stage", h.AdvanceStage)

		r.Get("/deals/{dealId}/tasks", h.ListTasks)
		r.Post("/deals/{dealId}/tasks", h.CreateTask)
		r.Patch("/tasks/{taskId}/status", h.UpdateTaskStatus)
	})

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
