package models

import "time"

type Vendor struct {
	ID          string
	AgentID     string
	Category    string
	Company     string
	ContactName string
	Phone       string
	Email       string
	Website     string
	Notes       string
	IsFeatured  bool
	SortOrder   int
	CreatedAt   time.Time
}
