package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/go-chi/chi/v5"
	"realtourflow/internal/docusign"
	"realtourflow/internal/middleware"
)

// SendForSignature — POST /deals/:dealId/documents/:documentId/send-for-signature
func (h *Handler) SendForSignature(w http.ResponseWriter, r *http.Request) {
	if h.docusignClient == nil || !h.docusignClient.Enabled() {
		http.Error(w, "DocuSign not configured", http.StatusServiceUnavailable)
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

	dealID := chi.URLParam(r, "dealId")
	docID := chi.URLParam(r, "documentId")

	// Verify caller owns the deal
	var agentID string
	err = h.db.QueryRowContext(r.Context(),
		`SELECT agent_id FROM deals WHERE id = $1 AND agent_id = $2`, dealID, userID,
	).Scan(&agentID)
	if err != nil {
		http.Error(w, "deal not found or access denied", http.StatusNotFound)
		return
	}

	// Get document record
	var docName, s3Key string
	err = h.db.QueryRowContext(r.Context(),
		`SELECT name, s3_key FROM documents WHERE id = $1 AND deal_id = $2`, docID, dealID,
	).Scan(&docName, &s3Key)
	if err != nil {
		http.Error(w, "document not found", http.StatusNotFound)
		return
	}

	// Parse signers from request body
	var req struct {
		Signers []struct {
			Email string `json:"email"`
			Name  string `json:"name"`
		} `json:"signers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Signers) == 0 {
		http.Error(w, "at least one signer required", http.StatusBadRequest)
		return
	}

	// Download document bytes from S3
	docBytes, err := h.downloadS3Object(r.Context(), s3Key)
	if err != nil {
		http.Error(w, "failed to retrieve document", http.StatusInternalServerError)
		return
	}

	// Build signers
	var signers []docusign.Signer
	for _, s := range req.Signers {
		if s.Email != "" && s.Name != "" {
			signers = append(signers, docusign.Signer{Email: s.Email, Name: s.Name})
		}
	}
	if len(signers) == 0 {
		http.Error(w, "no valid signers provided", http.StatusBadRequest)
		return
	}

	// Create DocuSign envelope
	envelopeID, err := h.docusignClient.CreateEnvelope(docName, docBytes, signers)
	if err != nil {
		http.Error(w, "failed to create envelope: "+err.Error(), http.StatusBadGateway)
		return
	}

	// Persist envelope ID + status
	now := time.Now()
	_, err = h.db.ExecContext(r.Context(), `
		UPDATE documents
		SET docusign_envelope_id = $1,
		    docusign_status      = 'sent',
		    docusign_sent_at     = $2
		WHERE id = $3
	`, envelopeID, now, docID)
	if err != nil {
		http.Error(w, "failed to persist envelope", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusOK, map[string]string{
		"envelope_id": envelopeID,
		"status":      "sent",
	})
}

// RefreshDocuSignStatus — POST /deals/:dealId/documents/:documentId/docusign/refresh
func (h *Handler) RefreshDocuSignStatus(w http.ResponseWriter, r *http.Request) {
	if h.docusignClient == nil || !h.docusignClient.Enabled() {
		http.Error(w, "DocuSign not configured", http.StatusServiceUnavailable)
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

	dealID := chi.URLParam(r, "dealId")
	docID := chi.URLParam(r, "documentId")

	// Verify access (agent or participant)
	ok, err := h.canAccessDeal(r, dealID, userID)
	if err != nil || !ok {
		http.Error(w, "access denied", http.StatusForbidden)
		return
	}

	var envelopeID string
	err = h.db.QueryRowContext(r.Context(),
		`SELECT COALESCE(docusign_envelope_id, '') FROM documents WHERE id = $1 AND deal_id = $2`,
		docID, dealID,
	).Scan(&envelopeID)
	if err != nil || envelopeID == "" {
		http.Error(w, "no envelope found", http.StatusNotFound)
		return
	}

	status, err := h.docusignClient.GetEnvelopeStatus(envelopeID)
	if err != nil {
		http.Error(w, "failed to get envelope status: "+err.Error(), http.StatusBadGateway)
		return
	}

	_, _ = h.db.ExecContext(r.Context(),
		`UPDATE documents SET docusign_status = $1 WHERE id = $2`, status, docID,
	)

	respond(w, http.StatusOK, map[string]string{"status": status})
}

// DocuSignWebhook — POST /docusign/webhook (public — registered in DocuSign Connect)
func (h *Handler) DocuSignWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		w.WriteHeader(http.StatusOK) // always 200 so DocuSign doesn't retry
		return
	}

	var payload struct {
		Event string `json:"event"`
		Data  struct {
			EnvelopeID      string `json:"envelopeId"`
			EnvelopeSummary struct {
				Status string `json:"status"`
			} `json:"envelopeSummary"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	envelopeID := payload.Data.EnvelopeID
	status := payload.Data.EnvelopeSummary.Status
	if envelopeID == "" || status == "" {
		w.WriteHeader(http.StatusOK)
		return
	}

	_, _ = h.db.ExecContext(r.Context(),
		`UPDATE documents SET docusign_status = $1 WHERE docusign_envelope_id = $2`,
		status, envelopeID,
	)

	w.WriteHeader(http.StatusOK)
}

// downloadS3Object fetches bytes for the given S3 key.
func (h *Handler) downloadS3Object(ctx context.Context, key string) ([]byte, error) {
	result, err := h.s3Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(h.s3Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, err
	}
	defer result.Body.Close()
	return io.ReadAll(result.Body)
}
