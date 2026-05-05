package models

import "time"

type DealStage string

const (
	StageIntake        DealStage = "intake"
	StageActiveSearch  DealStage = "active_search"
	StageOfferActive   DealStage = "offer_active"
	StageUnderContract DealStage = "under_contract"
	StagePreClose      DealStage = "pre_close"
	StageClosing       DealStage = "closing"
	StagePostClose     DealStage = "post_close"
)

var StageOrder = []DealStage{
	StageIntake, StageActiveSearch, StageOfferActive,
	StageUnderContract, StagePreClose, StageClosing, StagePostClose,
}

type DealType string

const (
	DealTypeBuy  DealType = "buy"
	DealTypeSell DealType = "sell"
)

type Deal struct {
	ID          string    `json:"id"`
	AgentID     string    `json:"agent_id"`
	Type        DealType  `json:"type"`
	Stage       DealStage `json:"stage"`
	Title       string    `json:"title"`
	Address     *string   `json:"address,omitempty"`
	Price       *float64  `json:"price,omitempty"`
	AriveLinked bool      `json:"arive_linked"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
