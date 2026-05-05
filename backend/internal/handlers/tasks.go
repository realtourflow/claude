package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"realtourflow/internal/middleware"
	"realtourflow/internal/models"
)

func (h *Handler) ListTasks(w http.ResponseWriter, r *http.Request) {
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

	var count int
	if err = h.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM deals WHERE id = $1 AND agent_id = $2`, dealID, userID,
	).Scan(&count); err != nil || count == 0 {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT id::TEXT, deal_id::TEXT, assigned_to::TEXT, title, description,
		       status, priority, source, stage_context, role, due_date::TEXT, created_at, updated_at
		FROM tasks
		WHERE deal_id = $1
		ORDER BY created_at ASC
	`, dealID)
	if err != nil {
		http.Error(w, "failed to fetch tasks", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	tasks := make([]*models.Task, 0)
	for rows.Next() {
		t := &models.Task{}
		if err := rows.Scan(
			&t.ID, &t.DealID, &t.AssignedTo, &t.Title, &t.Description,
			&t.Status, &t.Priority, &t.Source, &t.StageContext, &t.Role,
			&t.DueDate, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			http.Error(w, "failed to scan task", http.StatusInternalServerError)
			return
		}
		tasks = append(tasks, t)
	}

	respond(w, http.StatusOK, tasks)
}

func (h *Handler) CreateTask(w http.ResponseWriter, r *http.Request) {
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

	var count int
	if err = h.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM deals WHERE id = $1 AND agent_id = $2`, dealID, userID,
	).Scan(&count); err != nil || count == 0 {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	var req struct {
		Title        string  `json:"title"`
		Description  *string `json:"description"`
		Priority     string  `json:"priority"`
		Source       string  `json:"source"`
		StageContext *string `json:"stage_context"`
		Role         string  `json:"role"`
		DueDate      *string `json:"due_date"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Title == "" {
		http.Error(w, "title is required", http.StatusBadRequest)
		return
	}
	if req.Priority == "" {
		req.Priority = "medium"
	}
	if req.Source == "" {
		req.Source = "manual"
	}
	if req.Role == "" {
		req.Role = "agent"
	}

	task := &models.Task{}
	err = h.db.QueryRowContext(r.Context(), `
		INSERT INTO tasks (deal_id, title, description, priority, source, stage_context, role, due_date)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8::DATE)
		RETURNING id::TEXT, deal_id::TEXT, assigned_to::TEXT, title, description,
		          status, priority, source, stage_context, role, due_date::TEXT, created_at, updated_at
	`, dealID, req.Title, req.Description, req.Priority, req.Source, req.StageContext, req.Role, req.DueDate).Scan(
		&task.ID, &task.DealID, &task.AssignedTo, &task.Title, &task.Description,
		&task.Status, &task.Priority, &task.Source, &task.StageContext, &task.Role,
		&task.DueDate, &task.CreatedAt, &task.UpdatedAt,
	)
	if err != nil {
		http.Error(w, "failed to create task", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusCreated, task)
}

func (h *Handler) UpdateTaskStatus(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	taskID := chi.URLParam(r, "taskId")
	userID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	var req struct {
		Status models.TaskStatus `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	task := &models.Task{}
	err = h.db.QueryRowContext(r.Context(), `
		UPDATE tasks SET status = $1, updated_at = NOW()
		WHERE id = $2
		  AND deal_id IN (SELECT id FROM deals WHERE agent_id = $3)
		RETURNING id::TEXT, deal_id::TEXT, assigned_to::TEXT, title, description,
		          status, priority, source, stage_context, role, due_date::TEXT, created_at, updated_at
	`, req.Status, taskID, userID).Scan(
		&task.ID, &task.DealID, &task.AssignedTo, &task.Title, &task.Description,
		&task.Status, &task.Priority, &task.Source, &task.StageContext, &task.Role,
		&task.DueDate, &task.CreatedAt, &task.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		http.Error(w, "task not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to update task", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusOK, task)
}
