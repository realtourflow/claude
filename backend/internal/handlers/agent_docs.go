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
)

type agentDocTemplate struct {
	ID        string  `json:"id"`
	AgentID   string  `json:"agent_id"`
	Name      string  `json:"name"`
	DocType   string  `json:"doc_type"`
	FileName  string  `json:"file_name"`
	S3Key     string  `json:"s3_key"`
	MimeType  string  `json:"mime_type"`
	FileSize  int64   `json:"file_size"`
	Notes     *string `json:"notes"`
	CreatedAt string  `json:"created_at"`
}

func agentDocS3Key(agentID, fileName string) string {
	safe := strings.ReplaceAll(filepath.Base(fileName), " ", "-")
	return fmt.Sprintf("agent-templates/%s/%d/%s", agentID, time.Now().UnixNano(), safe)
}

// GetAgentDocUploadURL returns a pre-signed S3 PUT URL for an agent template upload.
func (h *Handler) GetAgentDocUploadURL(w http.ResponseWriter, r *http.Request) {
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

	key := agentDocS3Key(userID, req.FileName)
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

// CreateAgentDoc saves a template record after the browser uploads the file to S3.
func (h *Handler) CreateAgentDoc(w http.ResponseWriter, r *http.Request) {
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
		Name     string  `json:"name"`
		DocType  string  `json:"doc_type"`
		FileName string  `json:"file_name"`
		S3Key    string  `json:"s3_key"`
		MimeType string  `json:"mime_type"`
		FileSize int64   `json:"file_size"`
		Notes    *string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.Name == "" || req.S3Key == "" || req.DocType == "" {
		http.Error(w, "name, doc_type, and s3_key are required", http.StatusBadRequest)
		return
	}

	doc := agentDocTemplate{}
	err = h.db.QueryRowContext(r.Context(), `
		INSERT INTO agent_doc_templates (agent_id, name, doc_type, file_name, s3_key, mime_type, file_size, notes)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, agent_id, name, doc_type, file_name, s3_key, mime_type, file_size, notes, created_at
	`, userID, req.Name, req.DocType, req.FileName, req.S3Key, req.MimeType, req.FileSize, req.Notes).Scan(
		&doc.ID, &doc.AgentID, &doc.Name, &doc.DocType, &doc.FileName,
		&doc.S3Key, &doc.MimeType, &doc.FileSize, &doc.Notes, &doc.CreatedAt,
	)
	if err != nil {
		http.Error(w, "failed to save template", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusCreated, doc)
}

// ListAgentDocs returns all templates for the calling agent.
func (h *Handler) ListAgentDocs(w http.ResponseWriter, r *http.Request) {
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

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT id, agent_id, name, doc_type, file_name, s3_key, mime_type, file_size, notes, created_at
		FROM agent_doc_templates
		WHERE agent_id = $1
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	docs := []agentDocTemplate{}
	for rows.Next() {
		var doc agentDocTemplate
		if err := rows.Scan(&doc.ID, &doc.AgentID, &doc.Name, &doc.DocType, &doc.FileName,
			&doc.S3Key, &doc.MimeType, &doc.FileSize, &doc.Notes, &doc.CreatedAt); err != nil {
			continue
		}
		docs = append(docs, doc)
	}
	respond(w, http.StatusOK, docs)
}

// UpdateAgentDoc updates the name and/or notes of a template.
func (h *Handler) UpdateAgentDoc(w http.ResponseWriter, r *http.Request) {
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

	docID := chi.URLParam(r, "docId")
	var req struct {
		Name  *string `json:"name"`
		Notes *string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	doc := agentDocTemplate{}
	err = h.db.QueryRowContext(r.Context(), `
		UPDATE agent_doc_templates
		SET
			name  = COALESCE($1, name),
			notes = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE notes END
		WHERE id = $3 AND agent_id = $4
		RETURNING id, agent_id, name, doc_type, file_name, s3_key, mime_type, file_size, notes, created_at
	`, req.Name, req.Notes, docID, userID).Scan(
		&doc.ID, &doc.AgentID, &doc.Name, &doc.DocType, &doc.FileName,
		&doc.S3Key, &doc.MimeType, &doc.FileSize, &doc.Notes, &doc.CreatedAt,
	)
	if err != nil {
		http.Error(w, "template not found", http.StatusNotFound)
		return
	}

	respond(w, http.StatusOK, doc)
}

// DeleteAgentDoc removes a template record and its S3 object.
func (h *Handler) DeleteAgentDoc(w http.ResponseWriter, r *http.Request) {
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

	docID := chi.URLParam(r, "docId")
	var s3KeyVal string
	if err := h.db.QueryRowContext(r.Context(),
		`DELETE FROM agent_doc_templates WHERE id = $1 AND agent_id = $2 RETURNING s3_key`,
		docID, userID,
	).Scan(&s3KeyVal); err != nil {
		http.Error(w, "template not found", http.StatusNotFound)
		return
	}

	// Best-effort S3 delete
	h.s3Client.DeleteObject(r.Context(), &s3.DeleteObjectInput{
		Bucket: aws.String(h.s3Bucket),
		Key:    aws.String(s3KeyVal),
	})

	w.WriteHeader(http.StatusNoContent)
}

// GetAgentDocDownloadURL returns a pre-signed S3 GET URL for a template.
func (h *Handler) GetAgentDocDownloadURL(w http.ResponseWriter, r *http.Request) {
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

	docID := chi.URLParam(r, "docId")
	var s3KeyVal string
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT s3_key FROM agent_doc_templates WHERE id = $1 AND agent_id = $2`,
		docID, userID,
	).Scan(&s3KeyVal); err != nil {
		http.Error(w, "template not found", http.StatusNotFound)
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
