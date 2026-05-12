package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"realtourflow/internal/middleware"
	"realtourflow/internal/models"
)

// dealAccessForMessages returns (isAgent, hasAccess, agentID, error).
// Agents and deal participants can read/write client_thread messages.
// Only agents can access the internal channel.
func (h *Handler) dealAccessForMessages(r *http.Request, dealID, userID string) (isAgent bool, hasAccess bool, agentID string, err error) {
	err = h.db.QueryRowContext(r.Context(), `
		SELECT
			agent_id,
			agent_id = $2 AS is_agent,
			(agent_id = $2 OR EXISTS (
				SELECT 1 FROM deal_participants dp
				WHERE dp.deal_id = $1 AND dp.user_id = $2
			)) AS has_access
		FROM deals WHERE id = $1
	`, dealID, userID).Scan(&agentID, &isAgent, &hasAccess)
	return
}

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

	isAgent, hasAccess, _, err := h.dealAccessForMessages(r, dealID, userID)
	if err != nil || !hasAccess {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	channel := r.URL.Query().Get("channel")
	if channel != "client_thread" && channel != "internal" {
		channel = "client_thread"
	}
	// Non-agents can only see client_thread
	if !isAgent && channel == "internal" {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
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

	isAgent, hasAccess, agentID, err := h.dealAccessForMessages(r, dealID, userID)
	if err != nil || !hasAccess {
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
	// Participants (non-agent) can only post to client_thread
	if !isAgent && req.Channel == "internal" {
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

	// Fire message notifications in background
	go func() {
		title := fmt.Sprintf("New message on your deal")
		body := m.Body
		if len(body) > 80 {
			body = body[:80] + "…"
		}
		if isAgent {
			// Agent sent → notify all deal participants (buyer/seller)
			rows, err := h.db.QueryContext(context.Background(),
				`SELECT user_id FROM deal_participants WHERE deal_id = $1`, dealID)
			if err != nil {
				return
			}
			defer rows.Close()
			for rows.Next() {
				var pUID string
				if rows.Scan(&pUID) == nil {
					h.createNotification(pUID, title, body, "new_message", &dealID, nil)
				}
			}
		} else {
			// Participant sent → notify the agent
			h.createNotification(agentID, title, body, "new_message", &dealID, nil)
		}
	}()
}
