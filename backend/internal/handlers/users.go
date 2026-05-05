package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"

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

	custom, ok := claims.CustomClaims.(*middleware.CustomClaims)
	if !ok || len(custom.Roles) == 0 {
		http.Error(w, "no role assigned — assign a role in Auth0 dashboard first", http.StatusForbidden)
		return
	}

	var req syncUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	role := models.UserRole(custom.Roles[0])

	user, err := upsertUser(r.Context(), h.db, auth0ID, req.Email, req.Name, role)
	if err != nil {
		http.Error(w, "failed to sync user", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusOK, user)
}

func upsertUser(ctx context.Context, db *sql.DB, auth0ID, email, name string, role models.UserRole) (*models.User, error) {
	const q = `
		INSERT INTO users (auth0_id, email, name, role)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (auth0_id) DO UPDATE
		SET email      = EXCLUDED.email,
		    name       = EXCLUDED.name,
		    updated_at = NOW()
		RETURNING id, auth0_id, email, name, role, phone, created_at, updated_at
	`
	user := &models.User{}
	err := db.QueryRowContext(ctx, q, auth0ID, email, name, role).Scan(
		&user.ID, &user.Auth0ID, &user.Email, &user.Name, &user.Role,
		&user.Phone, &user.CreatedAt, &user.UpdatedAt,
	)
	return user, err
}
