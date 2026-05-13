package models

import "time"

type UserRole string

const (
	RoleAgent         UserRole = "agent"
	RoleBuyer         UserRole = "buyer"
	RoleSeller        UserRole = "seller"
	RoleAdmin         UserRole = "admin"
	RoleLendingPartner UserRole = "lending_partner"
)

type User struct {
	ID                 string    `json:"id"`
	Auth0ID            string    `json:"auth0_id"`
	Email              string    `json:"email"`
	Name               string    `json:"name"`
	Role               UserRole  `json:"role"`
	Phone              *string   `json:"phone,omitempty"`
	OnboardingComplete bool      `json:"onboarding_complete"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}
