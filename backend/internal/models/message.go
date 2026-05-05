package models

import "time"

type Message struct {
	ID         string    `json:"id"`
	DealID     string    `json:"deal_id"`
	SenderID   string    `json:"sender_id"`
	SenderName string    `json:"sender_name"`
	SenderRole string    `json:"sender_role"`
	Channel    string    `json:"channel"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"created_at"`
}
