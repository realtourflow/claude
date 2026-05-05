package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"realtourflow/internal/middleware"
	"realtourflow/internal/models"
)

func (h *Handler) ListVendors(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	userID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusUnauthorized)
		return
	}

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT id, agent_id, category, company,
		       COALESCE(contact_name,''), COALESCE(phone,''), COALESCE(email,''),
		       COALESCE(website,''), COALESCE(notes,''),
		       is_featured, sort_order, created_at
		FROM preferred_vendors
		WHERE agent_id = $1
		ORDER BY category, sort_order, created_at
	`, userID)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	vendors := make([]models.Vendor, 0)
	for rows.Next() {
		var v models.Vendor
		if err := rows.Scan(
			&v.ID, &v.AgentID, &v.Category, &v.Company,
			&v.ContactName, &v.Phone, &v.Email, &v.Website, &v.Notes,
			&v.IsFeatured, &v.SortOrder, &v.CreatedAt,
		); err != nil {
			http.Error(w, "scan error", http.StatusInternalServerError)
			return
		}
		vendors = append(vendors, v)
	}

	respond(w, http.StatusOK, marshalVendors(vendors))
}

func (h *Handler) CreateVendor(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	userID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusUnauthorized)
		return
	}

	var body struct {
		Category    string `json:"category"`
		Company     string `json:"company"`
		ContactName string `json:"contact_name"`
		Phone       string `json:"phone"`
		Email       string `json:"email"`
		Website     string `json:"website"`
		Notes       string `json:"notes"`
		IsFeatured  bool   `json:"is_featured"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if body.Category == "" || body.Company == "" {
		http.Error(w, "category and company required", http.StatusBadRequest)
		return
	}

	var v models.Vendor
	err = h.db.QueryRowContext(r.Context(), `
		INSERT INTO preferred_vendors
		  (agent_id, category, company, contact_name, phone, email, website, notes, is_featured, sort_order)
		VALUES (
		  $1, $2, $3,
		  NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), NULLIF($7,''), NULLIF($8,''),
		  $9,
		  COALESCE((SELECT MAX(sort_order)+1 FROM preferred_vendors WHERE agent_id=$1 AND category=$2), 0)
		)
		RETURNING id, agent_id, category, company,
		          COALESCE(contact_name,''), COALESCE(phone,''), COALESCE(email,''),
		          COALESCE(website,''), COALESCE(notes,''),
		          is_featured, sort_order, created_at
	`,
		userID, body.Category, body.Company,
		body.ContactName, body.Phone, body.Email, body.Website, body.Notes,
		body.IsFeatured,
	).Scan(
		&v.ID, &v.AgentID, &v.Category, &v.Company,
		&v.ContactName, &v.Phone, &v.Email, &v.Website, &v.Notes,
		&v.IsFeatured, &v.SortOrder, &v.CreatedAt,
	)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusCreated, marshalVendor(v))
}

func (h *Handler) UpdateVendor(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	userID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusUnauthorized)
		return
	}
	vendorID := chi.URLParam(r, "vendorId")

	var body struct {
		Company     *string `json:"company"`
		ContactName *string `json:"contact_name"`
		Phone       *string `json:"phone"`
		Email       *string `json:"email"`
		Website     *string `json:"website"`
		Notes       *string `json:"notes"`
		IsFeatured  *bool   `json:"is_featured"`
		SortOrder   *int    `json:"sort_order"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	var v models.Vendor
	err = h.db.QueryRowContext(r.Context(), `
		UPDATE preferred_vendors SET
		  company      = COALESCE($3, company),
		  contact_name = COALESCE($4, contact_name),
		  phone        = COALESCE($5, phone),
		  email        = COALESCE($6, email),
		  website      = COALESCE($7, website),
		  notes        = COALESCE($8, notes),
		  is_featured  = COALESCE($9, is_featured),
		  sort_order   = COALESCE($10, sort_order)
		WHERE id = $1 AND agent_id = $2
		RETURNING id, agent_id, category, company,
		          COALESCE(contact_name,''), COALESCE(phone,''), COALESCE(email,''),
		          COALESCE(website,''), COALESCE(notes,''),
		          is_featured, sort_order, created_at
	`,
		vendorID, userID,
		body.Company, body.ContactName, body.Phone, body.Email,
		body.Website, body.Notes, body.IsFeatured, body.SortOrder,
	).Scan(
		&v.ID, &v.AgentID, &v.Category, &v.Company,
		&v.ContactName, &v.Phone, &v.Email, &v.Website, &v.Notes,
		&v.IsFeatured, &v.SortOrder, &v.CreatedAt,
	)
	if err != nil {
		http.Error(w, "not found or forbidden", http.StatusNotFound)
		return
	}

	respond(w, http.StatusOK, marshalVendor(v))
}

func (h *Handler) DeleteVendor(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	userID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusUnauthorized)
		return
	}
	vendorID := chi.URLParam(r, "vendorId")

	res, err := h.db.ExecContext(r.Context(),
		`DELETE FROM preferred_vendors WHERE id = $1 AND agent_id = $2`,
		vendorID, userID,
	)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		http.Error(w, "not found or forbidden", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ── serialisation helpers ──────────────────────────────────────────────────────

type vendorJSON struct {
	ID          string    `json:"id"`
	AgentID     string    `json:"agent_id"`
	Category    string    `json:"category"`
	Company     string    `json:"company"`
	ContactName string    `json:"contact_name"`
	Phone       string    `json:"phone"`
	Email       string    `json:"email"`
	Website     string    `json:"website"`
	Notes       string    `json:"notes"`
	IsFeatured  bool      `json:"is_featured"`
	SortOrder   int       `json:"sort_order"`
	CreatedAt   time.Time `json:"created_at"`
}

func marshalVendor(v models.Vendor) vendorJSON {
	return vendorJSON{
		ID: v.ID, AgentID: v.AgentID, Category: v.Category, Company: v.Company,
		ContactName: v.ContactName, Phone: v.Phone, Email: v.Email,
		Website: v.Website, Notes: v.Notes, IsFeatured: v.IsFeatured,
		SortOrder: v.SortOrder, CreatedAt: v.CreatedAt,
	}
}

func marshalVendors(vs []models.Vendor) []vendorJSON {
	out := make([]vendorJSON, len(vs))
	for i, v := range vs {
		out[i] = marshalVendor(v)
	}
	return out
}
