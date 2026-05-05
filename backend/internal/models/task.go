package models

import "time"

type TaskStatus string

const (
	TaskStatusPending    TaskStatus = "pending"
	TaskStatusInProgress TaskStatus = "in_progress"
	TaskStatusCompleted  TaskStatus = "completed"
	TaskStatusSkipped    TaskStatus = "skipped"
)

type Task struct {
	ID           string     `json:"id"`
	DealID       string     `json:"deal_id"`
	AssignedTo   *string    `json:"assigned_to,omitempty"`
	Title        string     `json:"title"`
	Description  *string    `json:"description,omitempty"`
	Status       TaskStatus `json:"status"`
	Priority     string     `json:"priority"`
	Source       string     `json:"source"`
	StageContext *string    `json:"stage_context,omitempty"`
	Role         string     `json:"role"`
	DueDate      *string    `json:"due_date,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}
