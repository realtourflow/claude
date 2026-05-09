package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/go-chi/chi/v5"
)

type Handler struct {
	db       *sql.DB
	s3Client *s3.Client
	s3Bucket string
}

func New(db *sql.DB, s3Client *s3.Client, s3Bucket string) *Handler {
	return &Handler{db: db, s3Client: s3Client, s3Bucket: s3Bucket}
}

func (h *Handler) Routes(auth func(http.Handler) http.Handler) http.Handler {
	r := chi.NewRouter()

	r.Get("/health", h.Health)

	r.Group(func(r chi.Router) {
		r.Use(auth)
		r.Post("/users/sync", h.SyncUser)
			r.Get("/users", h.ListUsers)

		r.Get("/deals", h.ListDeals)
		r.Post("/deals", h.CreateDeal)
		r.Get("/deals/{dealId}", h.GetDeal)
		r.Patch("/deals/{dealId}/stage", h.AdvanceStage)

		r.Get("/deals/{dealId}/tasks", h.ListTasks)
		r.Post("/deals/{dealId}/tasks", h.CreateTask)
		r.Patch("/tasks/{taskId}/status", h.UpdateTaskStatus)

		r.Get("/deals/{dealId}/messages", h.ListMessages)
		r.Post("/deals/{dealId}/messages", h.CreateMessage)

		r.Get("/deals/{dealId}/documents", h.ListDocuments)
		r.Post("/deals/{dealId}/documents/upload-url", h.GetUploadURL)
		r.Post("/deals/{dealId}/documents", h.CreateDocument)
		r.Get("/documents/{documentId}/download-url", h.GetDownloadURL)
		r.Delete("/documents/{documentId}", h.DeleteDocument)

		r.Get("/vendors", h.ListVendors)
		r.Post("/vendors", h.CreateVendor)
		r.Patch("/vendors/{vendorId}", h.UpdateVendor)
		r.Delete("/vendors/{vendorId}", h.DeleteVendor)

		r.Get("/me/deals", h.ListMyDeals)
		r.Get("/deals/{dealId}/participants", h.ListParticipants)
		r.Post("/deals/{dealId}/participants", h.AddParticipant)
		r.Delete("/deals/{dealId}/participants/{userId}", h.RemoveParticipant)

		r.Get("/deals/{dealId}/checklist", h.ListChecklist)
		r.Post("/deals/{dealId}/checklist", h.CreateChecklistItem)
		r.Patch("/deals/{dealId}/checklist/{itemId}", h.UpdateChecklistItem)
		r.Delete("/deals/{dealId}/checklist/{itemId}", h.DeleteChecklistItem)
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
