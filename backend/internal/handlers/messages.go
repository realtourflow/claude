package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"realtourflow/internal/middleware"
	"realtourflow/internal/models"
)

func (h *Handler) ListMessages(w http.ResponseWriter, r *http.Request) {
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

	var exists bool
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM deals WHERE id = $1 AND agent_id = $2)`,
		dealID, userID,
	).Scan(&exists); err != nil || !exists {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	channel := r.URL.Query().Get("channel")
	if channel != "client_thread" && channel != "internal" {
		channel = "client_thread"
	}

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT m.id, m.deal_id, m.sender_id, u.name, u.role::TEXT, m.channel, m.body, m.created_at
		FROM messages m
		JOIN users u ON u.id = m.sender_id
		WHERE m.deal_id = $1 AND m.channel = $2
		ORDER BY m.created_at ASC
	`, dealID, channel)
	if err != nil {
		http.Error(w, "failed to fetch messages", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	messages := make([]*models.Message, 0)
	for rows.Next() {
		m := &models.Message{}
		if err := rows.Scan(&m.ID, &m.DealID, &m.SenderID, &m.SenderName, &m.SenderRole, &m.Channel, &m.Body, &m.CreatedAt); err != nil {
			http.Error(w, "failed to scan message", http.StatusInternalServerError)
			return
		}
		messages = append(messages, m)
	}

	respond(w, http.StatusOK, messages)
}

func (h *Handler) CreateMessage(w http.ResponseWriter, r *http.Request) {
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

	var exists bool
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM deals WHERE id = $1 AND agent_id = $2)`,
		dealID, userID,
	).Scan(&exists); err != nil || !exists {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	var req struct {
		Channel string `json:"channel"`
		Body    string `json:"body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Body == "" {
		http.Error(w, "body is required", http.StatusBadRequest)
		return
	}
	if req.Channel != "client_thread" && req.Channel != "internal" {
		req.Channel = "client_thread"
	}

	m := &models.Message{}
	err = h.db.QueryRowContext(r.Context(), `
		WITH inserted AS (
			INSERT INTO messages (deal_id, sender_id, channel, body)
			VALUES ($1, $2, $3, $4)
			RETURNING id, deal_id, sender_id, channel, body, created_at
		)
		SELECT i.id, i.deal_id, i.sender_id, u.name, u.role::TEXT, i.channel, i.body, i.created_at
		FROM inserted i
		JOIN users u ON u.id = i.sender_id
	`, dealID, userID, req.Channel, req.Body).Scan(
		&m.ID, &m.DealID, &m.SenderID, &m.SenderName, &m.SenderRole, &m.Channel, &m.Body, &m.CreatedAt,
	)
	if err != nil {
		http.Error(w, "failed to create message", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusCreated, m)
}
