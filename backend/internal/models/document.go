package models

import "time"

type Document struct {
	ID           string    `json:"id"`
	DealID       string    `json:"deal_id"`
	UploadedBy   string    `json:"uploaded_by"`
	UploaderName string    `json:"uploader_name"`
	Name         string    `json:"name"`
	S3Key        string    `json:"s3_key"`
	MimeType     string    `json:"mime_type"`
	FileSize     int64     `json:"file_size"`
	CreatedAt    time.Time `json:"created_at"`
}
