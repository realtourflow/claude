package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"realtourflow/internal/arive"
	"realtourflow/internal/middleware"
)

// AriveWebhook receives event notifications from ARIVE.
// ARIVE sends { "loanId": "...", "event": "LOAN_TRACKERS_UPDATED" }.
// We look up the deal by arive_loan_id, fetch fresh loan data, and store it.
func (h *Handler) AriveWebhook(w http.ResponseWriter, r *http.Request) {
	if h.ariveClient == nil || !h.ariveClient.Enabled() {
		http.Error(w, "arive not configured", http.StatusServiceUnavailable)
		return
	}

	var payload arive.WebhookPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}

	loanID := payload.ResolvedLoanID()
	if loanID == "" {
		http.Error(w, "missing loanId", http.StatusBadRequest)
		return
	}

	// Acknowledge immediately — ARIVE expects a fast 200.
	w.WriteHeader(http.StatusOK)

	// Sync in background so we don't block the ARIVE webhook timeout.
	go func() {
		if err := h.syncAriveLoan(loanID); err != nil {
			log.Printf("arive sync error for loan %s: %v", loanID, err)
		}
	}()
}

// LinkAriveLoan links a deal to an ARIVE loan ID and does an initial sync.
// PATCH /deals/:dealId/arive  body: { "arive_loan_id": "..." }
func (h *Handler) LinkAriveLoan(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	dealID := chi.URLParam(r, "dealId")
	userID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	var req struct {
		AriveLoanID string `json:"arive_loan_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.AriveLoanID == "" {
		http.Error(w, "arive_loan_id is required", http.StatusBadRequest)
		return
	}

	// Verify deal ownership.
	var agentID string
	err = h.db.QueryRowContext(r.Context(),
		`SELECT agent_id FROM deals WHERE id = $1`, dealID,
	).Scan(&agentID)
	if err == sql.ErrNoRows {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	if agentID != userID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	// Persist the link.
	_, err = h.db.ExecContext(r.Context(),
		`UPDATE deals SET arive_loan_id = $1, arive_linked = true WHERE id = $2`,
		req.AriveLoanID, dealID,
	)
	if err != nil {
		http.Error(w, "failed to link arive loan", http.StatusInternalServerError)
		return
	}

	// Kick off initial sync.
	if h.ariveClient != nil && h.ariveClient.Enabled() {
		go func() {
			if err := h.syncAriveLoan(req.AriveLoanID); err != nil {
				log.Printf("initial arive sync for loan %s: %v", req.AriveLoanID, err)
			}
		}()
	}

	respond(w, http.StatusOK, map[string]string{"status": "linked"})
}

// SyncAriveLoan force-syncs a deal's ARIVE data on demand.
// POST /deals/:dealId/arive/sync
func (h *Handler) SyncAriveLoan(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if h.ariveClient == nil || !h.ariveClient.Enabled() {
		http.Error(w, "arive not configured", http.StatusServiceUnavailable)
		return
	}

	dealID := chi.URLParam(r, "dealId")

	var loanID string
	err := h.db.QueryRowContext(r.Context(),
		`SELECT arive_loan_id FROM deals WHERE id = $1`, dealID,
	).Scan(&loanID)
	if err == sql.ErrNoRows || loanID == "" {
		http.Error(w, "deal not linked to arive", http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	if err := h.syncAriveLoan(loanID); err != nil {
		http.Error(w, "sync failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusOK, map[string]string{"status": "synced"})
}

// syncAriveLoan fetches fresh data from ARIVE and stores it in the DB.
// Called from the webhook handler and on initial link.
func (h *Handler) syncAriveLoan(loanID string) error {
	loan, err := h.ariveClient.GetLoan(context.Background(), loanID)
	if err != nil {
		return err
	}

	milestonesJSON, err := json.Marshal(loan.LoanTrackers)
	if err != nil {
		return err
	}

	keyDatesJSON := []byte("{}")
	if loan.KeyDates != nil {
		keyDatesJSON = loan.KeyDates
	}

	_, err = h.db.Exec(`
		UPDATE deals
		SET arive_milestones  = $1,
		    arive_key_dates   = $2,
		    arive_loan_status = $3,
		    arive_synced_at   = $4
		WHERE arive_loan_id = $5
	`,
		milestonesJSON,
		keyDatesJSON,
		loan.CurrentLoanStatus.Status,
		time.Now().UTC(),
		loanID,
	)
	return err
}
