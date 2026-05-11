package models

import (
	"encoding/json"
	"time"
)

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
	ID               string           `json:"id"`
	AgentID          string           `json:"agent_id"`
	Type             DealType         `json:"type"`
	Stage            DealStage        `json:"stage"`
	Health           string           `json:"health"`
	Title            string           `json:"title"`
	Address          *string          `json:"address,omitempty"`
	Price            *float64         `json:"price,omitempty"`
	AriveLinked      bool             `json:"arive_linked"`
	AriveLoanID      *string          `json:"arive_loan_id,omitempty"`
	AriveMilestones  *json.RawMessage `json:"arive_milestones,omitempty"`
	AriveKeyDates    *json.RawMessage `json:"arive_key_dates,omitempty"`
	AriveLoanStatus  *string          `json:"arive_loan_status,omitempty"`
	AriveSyncedAt    *time.Time       `json:"arive_synced_at,omitempty"`
	Notes            *string          `json:"notes,omitempty"`
	FeeStatus        string           `json:"fee_status"`
	FeeAmountCents   int              `json:"fee_amount_cents"`
	FeePaidAt        *time.Time       `json:"fee_paid_at,omitempty"`
	FastPass         *json.RawMessage `json:"fast_pass,omitempty"`
	SmoothExit       *json.RawMessage `json:"smooth_exit,omitempty"`
	CreatedAt        time.Time        `json:"created_at"`
	UpdatedAt        time.Time        `json:"updated_at"`
}
