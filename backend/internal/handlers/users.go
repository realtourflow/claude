package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"realtourflow/internal/middleware"
	"realtourflow/internal/models"
)

type syncUserRequest struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}

func (h *Handler) SyncUser(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	auth0ID := claims.RegisteredClaims.Subject

	custom, _ := claims.CustomClaims.(*middleware.CustomClaims)
	jwtRole := ""
	if custom != nil && len(custom.Roles) > 0 {
		jwtRole = custom.Roles[0]
	}

	var req syncUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	var role models.UserRole
	if jwtRole != "" {
		role = models.UserRole(jwtRole)
	} else {
		// No role in JWT — check if user was pre-created via agent invite claim
		var dbRole string
		err := h.db.QueryRowContext(r.Context(),
			`SELECT role FROM users WHERE auth0_id = $1`, auth0ID).Scan(&dbRole)
		if err != nil {
			http.Error(w, "no role assigned — request an invite from your administrator", http.StatusForbidden)
			return
		}
		role = models.UserRole(dbRole)
	}

	user, err := upsertUser(r.Context(), h.db, auth0ID, req.Email, req.Name, role)
	if err != nil {
		http.Error(w, "failed to sync user", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusOK, user)
}

func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	isAdmin := false
	for _, role := range middleware.GetRoles(r) {
		if role == "admin" {
			isAdmin = true
			break
		}
	}
	if !isAdmin {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT id, email, name, role, phone, created_at, deactivated_at
		FROM users
		ORDER BY role, name
	`)
	if err != nil {
		http.Error(w, "failed to list users", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type apiUser struct {
		ID            string  `json:"id"`
		Email         string  `json:"email"`
		Name          string  `json:"name"`
		Role          string  `json:"role"`
		Phone         *string `json:"phone,omitempty"`
		CreatedAt     string  `json:"created_at"`
		DeactivatedAt *string `json:"deactivated_at,omitempty"`
	}

	var users []apiUser
	for rows.Next() {
		var u apiUser
		var phone sql.NullString
		var createdAt time.Time
		var deactivatedAt sql.NullTime
		if err := rows.Scan(&u.ID, &u.Email, &u.Name, &u.Role, &phone, &createdAt, &deactivatedAt); err != nil {
			http.Error(w, "failed to scan user", http.StatusInternalServerError)
			return
		}
		if phone.Valid {
			u.Phone = &phone.String
		}
		u.CreatedAt = createdAt.Format(time.RFC3339)
		if deactivatedAt.Valid {
			s := deactivatedAt.Time.Format(time.RFC3339)
			u.DeactivatedAt = &s
		}
		users = append(users, u)
	}
	if users == nil {
		users = []apiUser{}
	}
	respond(w, http.StatusOK, users)
}

// DeactivateUser — admin only; sets deactivated_at to NOW().
func (h *Handler) DeactivateUser(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	isAdmin := false
	for _, role := range middleware.GetRoles(r) {
		if role == "admin" { isAdmin = true; break }
	}
	if !isAdmin {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	targetID := chi.URLParam(r, "userId")
	res, err := h.db.ExecContext(r.Context(),
		`UPDATE users SET deactivated_at = NOW() WHERE id = $1 AND deactivated_at IS NULL`,
		targetID,
	)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		http.Error(w, "user not found or already deactivated", http.StatusNotFound)
		return
	}
	respond(w, http.StatusOK, map[string]bool{"ok": true})

	if claims != nil {
		if actorID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject); err == nil {
			h.logAudit(&actorID, "user_deactivate", nil, &targetID, nil)
		}
	}
}

// ActivateUser — admin only; clears deactivated_at.
func (h *Handler) ActivateUser(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	isAdmin := false
	for _, role := range middleware.GetRoles(r) {
		if role == "admin" { isAdmin = true; break }
	}
	if !isAdmin {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	targetID := chi.URLParam(r, "userId")
	res, err := h.db.ExecContext(r.Context(),
		`UPDATE users SET deactivated_at = NULL WHERE id = $1`,
		targetID,
	)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	respond(w, http.StatusOK, map[string]bool{"ok": true})

	if claims != nil {
		if actorID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject); err == nil {
			h.logAudit(&actorID, "user_activate", nil, &targetID, nil)
		}
	}
}

func upsertUser(ctx context.Context, db *sql.DB, auth0ID, email, name string, role models.UserRole) (*models.User, error) {
	// Preserve the existing name if the user has already set one in onboarding/profile.
	// Auth0 often defaults user.name to the email address, so overwriting on every
	// sync would clobber the real name the agent saved during onboarding.
	const q = `
		INSERT INTO users (auth0_id, email, name, role)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (auth0_id) DO UPDATE
		SET email      = EXCLUDED.email,
		    name       = CASE
		                   WHEN users.name IS NULL OR users.name = '' OR users.name = users.email
		                   THEN EXCLUDED.name
		                   ELSE users.name
		                 END,
		    role       = EXCLUDED.role,
		    updated_at = NOW()
		RETURNING id, auth0_id, email, name, role, phone, onboarding_complete, created_at, updated_at
	`
	user := &models.User{}
	err := db.QueryRowContext(ctx, q, auth0ID, email, name, role).Scan(
		&user.ID, &user.Auth0ID, &user.Email, &user.Name, &user.Role,
		&user.Phone, &user.OnboardingComplete, &user.CreatedAt, &user.UpdatedAt,
	)
	return user, err
}
