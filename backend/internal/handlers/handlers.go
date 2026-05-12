package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/go-chi/chi/v5"
	"realtourflow/internal/arive"
)

type Handler struct {
	db                  *sql.DB
	s3Client            *s3.Client
	s3Bucket            string
	ariveClient         *arive.Client
	stripeKey           string
	stripeWebhookSecret string
}

func New(db *sql.DB, s3Client *s3.Client, s3Bucket string, ariveClient *arive.Client, stripeKey, stripeWebhookSecret string) *Handler {
	return &Handler{
		db:                  db,
		s3Client:            s3Client,
		s3Bucket:            s3Bucket,
		ariveClient:         ariveClient,
		stripeKey:           stripeKey,
		stripeWebhookSecret: stripeWebhookSecret,
	}
}

func (h *Handler) Routes(auth func(http.Handler) http.Handler) http.Handler {
	r := chi.NewRouter()

	r.Get("/health", h.Health)

	// Public — no auth required
	r.Get("/invites/role", h.GetInviteRole)
	r.Get("/invites/{token}", h.GetInvite)
	r.Post("/arive/webhook", h.AriveWebhook)
	r.Post("/stripe/webhook", h.StripeWebhook)

	r.Group(func(r chi.Router) {
		r.Use(auth)
		r.Post("/users/sync", h.SyncUser)
		r.Get("/users", h.ListUsers)

		r.Get("/deals", h.ListDeals)
		r.Post("/deals", h.CreateDeal)
		r.Get("/deals/{dealId}", h.GetDeal)
		r.Patch("/deals/{dealId}/stage", h.AdvanceStage)
		r.Patch("/deals/{dealId}/notes", h.UpdateDealNotes)
		r.Patch("/deals/{dealId}/flags", h.PatchDealFlags)
		r.Post("/deals/{dealId}/baa/sign", h.SignBAA)

		r.Get("/tasks", h.ListAllTasks)
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
		r.Get("/me/settings", h.GetSettings)
		r.Put("/me/settings", h.PutSettings)
		r.Patch("/me/profile", h.PatchProfile)
		r.Get("/me/tc", h.GetMyTC)
		r.Put("/me/tc", h.PutMyTC)
		r.Delete("/me/tc", h.DeleteMyTC)
		r.Get("/me/agents", h.ListMyAgents)

		r.Get("/me/doc-templates", h.ListAgentDocs)
		r.Post("/me/doc-templates/upload-url", h.GetAgentDocUploadURL)
		r.Post("/me/doc-templates", h.CreateAgentDoc)
		r.Patch("/me/doc-templates/{docId}", h.UpdateAgentDoc)
		r.Delete("/me/doc-templates/{docId}", h.DeleteAgentDoc)
		r.Get("/me/doc-templates/{docId}/download-url", h.GetAgentDocDownloadURL)

		r.Get("/deals/{dealId}/participants", h.ListParticipants)
		r.Post("/deals/{dealId}/participants", h.AddParticipant)
		r.Delete("/deals/{dealId}/participants/{userId}", h.RemoveParticipant)

		r.Get("/deals/{dealId}/checklist", h.ListChecklist)
		r.Post("/deals/{dealId}/checklist", h.CreateChecklistItem)
		r.Patch("/deals/{dealId}/checklist/{itemId}", h.UpdateChecklistItem)
		r.Delete("/deals/{dealId}/checklist/{itemId}", h.DeleteChecklistItem)

		r.Get("/deals/{dealId}/contingencies", h.ListContingencies)
		r.Post("/deals/{dealId}/contingencies", h.CreateContingency)
		r.Patch("/deals/{dealId}/contingencies/{contingencyId}", h.UpdateContingency)
		r.Delete("/deals/{dealId}/contingencies/{contingencyId}", h.DeleteContingency)

		r.Post("/deals/{dealId}/invite", h.CreateInvite)
		r.Post("/invites/{token}/claim", h.ClaimInvite)

		r.Patch("/deals/{dealId}/arive", h.LinkAriveLoan)
		r.Post("/deals/{dealId}/arive/sync", h.SyncAriveLoan)

		r.Post("/deals/{dealId}/fee/checkout", h.FeeCheckout)
		r.Post("/deals/{dealId}/fee/waive", h.WaiveFee)

		r.Post("/deals/{dealId}/fastpass", h.EnrollFastPass)
		r.Post("/deals/{dealId}/smoothexit", h.EnrollSmoothExit)

		r.Get("/deals/{dealId}/properties", h.ListProperties)
		r.Post("/deals/{dealId}/properties", h.CreateProperty)
		r.Patch("/properties/{propertyId}", h.UpdateProperty)
		r.Delete("/properties/{propertyId}", h.DeleteProperty)

		r.Get("/deals/{dealId}/showing-availability", h.GetShowingAvailability)
		r.Put("/deals/{dealId}/showing-availability", h.PutShowingAvailability)

		r.Get("/deals/{dealId}/offers", h.ListOffers)
		r.Post("/deals/{dealId}/offers", h.CreateOffer)
		r.Delete("/offers/{offerId}", h.DeleteOffer)

		r.Get("/deals/{dealId}/net-sheet", h.GetOrCreateNetSheet)
		r.Put("/deals/{dealId}/net-sheet", h.PutNetSheet)
		r.Post("/deals/{dealId}/net-sheet/ready", h.MarkNetSheetReady)

		r.Get("/notifications", h.ListNotifications)
		r.Patch("/notifications/{notifId}/read", h.MarkNotificationRead)
		r.Post("/notifications/read-all", h.MarkAllNotificationsRead)
	})

	return r
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	respond(w, http.StatusOK, map[string]string{"status": "ok"})
}

func respond(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		json.NewEncoder(w).Encode(data)
	}
}
