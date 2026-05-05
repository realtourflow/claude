package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/go-chi/chi/v5"
	"realtourflow/internal/middleware"
	"realtourflow/internal/models"
)

func s3Key(dealID, fileName string) string {
	safe := strings.ReplaceAll(filepath.Base(fileName), " ", "-")
	return fmt.Sprintf("deals/%s/%d/%s", dealID, time.Now().UnixNano(), safe)
}

func (h *Handler) ownsDeaL(r *http.Request, dealID, userID string) (bool, error) {
	var exists bool
	err := h.db.QueryRowContext(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM deals WHERE id = $1 AND agent_id = $2)`,
		dealID, userID,
	).Scan(&exists)
	return exists, err
}

// GetUploadURL returns a pre-signed S3 PUT URL the browser uses to upload directly.
func (h *Handler) GetUploadURL(w http.ResponseWriter, r *http.Request) {
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

	ok, err := h.ownsDeaL(r, dealID, userID)
	if err != nil || !ok {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	var req struct {
		FileName string `json:"file_name"`
		MimeType string `json:"mime_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.FileName == "" {
		http.Error(w, "file_name is required", http.StatusBadRequest)
		return
	}
	if req.MimeType == "" {
		req.MimeType = "application/octet-stream"
	}

	key := s3Key(dealID, req.FileName)

	presign := s3.NewPresignClient(h.s3Client)
	presigned, err := presign.PresignPutObject(r.Context(), &s3.PutObjectInput{
		Bucket:      aws.String(h.s3Bucket),
		Key:         aws.String(key),
		ContentType: aws.String(req.MimeType),
	}, s3.WithPresignExpires(15*time.Minute))
	if err != nil {
		http.Error(w, "failed to generate upload URL", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusOK, map[string]string{
		"upload_url": presigned.URL,
		"s3_key":     key,
	})
}

// CreateDocument saves a document record after the browser has uploaded the file to S3.
func (h *Handler) CreateDocument(w http.ResponseWriter, r *http.Request) {
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

	ok, err := h.ownsDeaL(r, dealID, userID)
	if err != nil || !ok {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	var req struct {
		Name     string `json:"name"`
		S3Key    string `json:"s3_key"`
		MimeType string `json:"mime_type"`
		FileSize int64  `json:"file_size"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Name == "" || req.S3Key == "" {
		http.Error(w, "name and s3_key are required", http.StatusBadRequest)
		return
	}

	doc := &models.Document{}
	err = h.db.QueryRowContext(r.Context(), `
		WITH inserted AS (
			INSERT INTO documents (deal_id, uploaded_by, name, s3_key, mime_type, file_size)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id, deal_id, uploaded_by, name, s3_key, mime_type, file_size, created_at
		)
		SELECT i.id, i.deal_id, i.uploaded_by, u.name, i.name, i.s3_key, i.mime_type, i.file_size, i.created_at
		FROM inserted i
		JOIN users u ON u.id = i.uploaded_by
	`, dealID, userID, req.Name, req.S3Key, req.MimeType, req.FileSize).Scan(
		&doc.ID, &doc.DealID, &doc.UploadedBy, &doc.UploaderName,
		&doc.Name, &doc.S3Key, &doc.MimeType, &doc.FileSize, &doc.CreatedAt,
	)
	if err != nil {
		http.Error(w, "failed to save document", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusCreated, doc)
}

// ListDocuments returns all documents for a deal.
func (h *Handler) ListDocuments(w http.ResponseWriter, r *http.Request) {
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

	ok, err := h.ownsDeaL(r, dealID, userID)
	if err != nil || !ok {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT d.id, d.deal_id, d.uploaded_by, u.name, d.name, d.s3_key, d.mime_type, d.file_size, d.created_at
		FROM documents d
		JOIN users u ON u.id = d.uploaded_by
		WHERE d.deal_id = $1
		ORDER BY d.created_at DESC
	`, dealID)
	if err != nil {
		http.Error(w, "failed to fetch documents", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	docs := make([]*models.Document, 0)
	for rows.Next() {
		doc := &models.Document{}
		if err := rows.Scan(
			&doc.ID, &doc.DealID, &doc.UploadedBy, &doc.UploaderName,
			&doc.Name, &doc.S3Key, &doc.MimeType, &doc.FileSize, &doc.CreatedAt,
		); err != nil {
			http.Error(w, "failed to scan document", http.StatusInternalServerError)
			return
		}
		docs = append(docs, doc)
	}

	respond(w, http.StatusOK, docs)
}

// GetDownloadURL returns a pre-signed S3 GET URL for the given document.
func (h *Handler) GetDownloadURL(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	docID := chi.URLParam(r, "documentId")
	userID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	var s3KeyVal string
	err = h.db.QueryRowContext(r.Context(), `
		SELECT d.s3_key FROM documents d
		JOIN deals ON deals.id = d.deal_id
		WHERE d.id = $1 AND deals.agent_id = $2
	`, docID, userID).Scan(&s3KeyVal)
	if err != nil {
		http.Error(w, "document not found", http.StatusNotFound)
		return
	}

	presign := s3.NewPresignClient(h.s3Client)
	presigned, err := presign.PresignGetObject(r.Context(), &s3.GetObjectInput{
		Bucket: aws.String(h.s3Bucket),
		Key:    aws.String(s3KeyVal),
	}, s3.WithPresignExpires(15*time.Minute))
	if err != nil {
		http.Error(w, "failed to generate download URL", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusOK, map[string]string{"download_url": presigned.URL})
}

// DeleteDocument removes the document record and its S3 object.
func (h *Handler) DeleteDocument(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	docID := chi.URLParam(r, "documentId")
	userID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	var s3KeyVal string
	err = h.db.QueryRowContext(r.Context(), `
		SELECT d.s3_key FROM documents d
		JOIN deals ON deals.id = d.deal_id
		WHERE d.id = $1 AND deals.agent_id = $2
	`, docID, userID).Scan(&s3KeyVal)
	if err != nil {
		http.Error(w, "document not found", http.StatusNotFound)
		return
	}

	if _, err := h.db.ExecContext(r.Context(),
		`DELETE FROM documents WHERE id = $1`, docID,
	); err != nil {
		http.Error(w, "failed to delete document", http.StatusInternalServerError)
		return
	}

	// Best-effort S3 delete — log but don't fail if the object is already gone
	h.s3Client.DeleteObject(r.Context(), &s3.DeleteObjectInput{
		Bucket: aws.String(h.s3Bucket),
		Key:    aws.String(s3KeyVal),
	})

	w.WriteHeader(http.StatusNoContent)
}
