package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"realtourflow/internal/middleware"
)

type trackedPropertyRow struct {
	ID                string    `json:"id"`
	DealID            string    `json:"deal_id"`
	Address           string    `json:"address"`
	City              string    `json:"city"`
	State             string    `json:"state"`
	Price             int       `json:"price"`
	Beds              float64   `json:"beds"`
	Baths             float64   `json:"baths"`
	Sqft              int       `json:"sqft"`
	ThumbnailURL      string    `json:"thumbnail_url"`
	SourceURL         string    `json:"source_url"`
	Status            string    `json:"status"`
	AddedBy           string    `json:"added_by"`
	AgentNote         *string   `json:"agent_note"`
	BuyerNote         *string   `json:"buyer_note"`
	AgentPrivateNote  *string   `json:"agent_private_note"`
	OfferRequested    bool      `json:"offer_requested"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

func (h *Handler) checkDealAccess(r *http.Request, dealID, userID string) bool {
	var count int
	h.db.QueryRowContext(r.Context(), `
		SELECT COUNT(*) FROM deals
		WHERE id = $1 AND (
			agent_id = $2 OR
			EXISTS (SELECT 1 FROM deal_participants WHERE deal_id = $1 AND user_id = $2)
		)
	`, dealID, userID).Scan(&count)
	return count > 0
}

func (h *Handler) ListProperties(w http.ResponseWriter, r *http.Request) {
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
	dealID := chi.URLParam(r, "dealId")
	if !h.checkDealAccess(r, dealID, userID) {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT id, deal_id, address, city, state, price, beds, baths, sqft,
		       thumbnail_url, source_url, status, added_by,
		       agent_note, buyer_note, agent_private_note, offer_requested,
		       created_at, updated_at
		FROM tracked_properties
		WHERE deal_id = $1
		ORDER BY created_at ASC
	`, dealID)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := make([]trackedPropertyRow, 0)
	for rows.Next() {
		var p trackedPropertyRow
		if err := rows.Scan(
			&p.ID, &p.DealID, &p.Address, &p.City, &p.State, &p.Price,
			&p.Beds, &p.Baths, &p.Sqft, &p.ThumbnailURL, &p.SourceURL,
			&p.Status, &p.AddedBy, &p.AgentNote, &p.BuyerNote, &p.AgentPrivateNote,
			&p.OfferRequested, &p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			http.Error(w, "scan error", http.StatusInternalServerError)
			return
		}
		result = append(result, p)
	}
	respond(w, http.StatusOK, result)
}

func (h *Handler) CreateProperty(w http.ResponseWriter, r *http.Request) {
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
	dealID := chi.URLParam(r, "dealId")
	if !h.checkDealAccess(r, dealID, userID) {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	var req struct {
		Address      string  `json:"address"`
		City         string  `json:"city"`
		State        string  `json:"state"`
		Price        int     `json:"price"`
		Beds         float64 `json:"beds"`
		Baths        float64 `json:"baths"`
		Sqft         int     `json:"sqft"`
		ThumbnailURL string  `json:"thumbnail_url"`
		SourceURL    string  `json:"source_url"`
		Status       string  `json:"status"`
		AddedBy      string  `json:"added_by"`
		AgentNote    *string `json:"agent_note"`
		BuyerNote    *string `json:"buyer_note"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Address == "" {
		http.Error(w, "address is required", http.StatusBadRequest)
		return
	}
	if req.Status == "" {
		req.Status = "interested"
	}
	if req.AddedBy == "" {
		req.AddedBy = "agent"
	}

	var p trackedPropertyRow
	err = h.db.QueryRowContext(r.Context(), `
		INSERT INTO tracked_properties
		  (deal_id, address, city, state, price, beds, baths, sqft,
		   thumbnail_url, source_url, status, added_by, agent_note, buyer_note)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		RETURNING id, deal_id, address, city, state, price, beds, baths, sqft,
		          thumbnail_url, source_url, status, added_by,
		          agent_note, buyer_note, agent_private_note, offer_requested,
		          created_at, updated_at
	`, dealID, req.Address, req.City, req.State, req.Price,
		req.Beds, req.Baths, req.Sqft, req.ThumbnailURL, req.SourceURL,
		req.Status, req.AddedBy, req.AgentNote, req.BuyerNote,
	).Scan(
		&p.ID, &p.DealID, &p.Address, &p.City, &p.State, &p.Price,
		&p.Beds, &p.Baths, &p.Sqft, &p.ThumbnailURL, &p.SourceURL,
		&p.Status, &p.AddedBy, &p.AgentNote, &p.BuyerNote, &p.AgentPrivateNote,
		&p.OfferRequested, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		http.Error(w, "failed to create property", http.StatusInternalServerError)
		return
	}
	respond(w, http.StatusCreated, p)
}

func (h *Handler) UpdateProperty(w http.ResponseWriter, r *http.Request) {
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
	propertyID := chi.URLParam(r, "propertyId")

	var dealID string
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT deal_id FROM tracked_properties WHERE id = $1`, propertyID,
	).Scan(&dealID); err != nil {
		http.Error(w, "property not found", http.StatusNotFound)
		return
	}
	if !h.checkDealAccess(r, dealID, userID) {
		http.Error(w, "property not found", http.StatusNotFound)
		return
	}

	var req struct {
		Status           *string `json:"status"`
		BuyerNote        *string `json:"buyer_note"`
		AgentNote        *string `json:"agent_note"`
		AgentPrivateNote *string `json:"agent_private_note"`
		OfferRequested   *bool   `json:"offer_requested"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	if req.Status != nil {
		h.db.ExecContext(r.Context(),
			`UPDATE tracked_properties SET status = $1, updated_at = NOW() WHERE id = $2`,
			*req.Status, propertyID)
	}
	if req.BuyerNote != nil {
		h.db.ExecContext(r.Context(),
			`UPDATE tracked_properties SET buyer_note = $1, updated_at = NOW() WHERE id = $2`,
			*req.BuyerNote, propertyID)
	}
	if req.AgentNote != nil {
		h.db.ExecContext(r.Context(),
			`UPDATE tracked_properties SET agent_note = $1, updated_at = NOW() WHERE id = $2`,
			*req.AgentNote, propertyID)
	}
	if req.AgentPrivateNote != nil {
		h.db.ExecContext(r.Context(),
			`UPDATE tracked_properties SET agent_private_note = $1, updated_at = NOW() WHERE id = $2`,
			*req.AgentPrivateNote, propertyID)
	}
	if req.OfferRequested != nil {
		h.db.ExecContext(r.Context(),
			`UPDATE tracked_properties SET offer_requested = $1, updated_at = NOW() WHERE id = $2`,
			*req.OfferRequested, propertyID)
	}

	respond(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) DeleteProperty(w http.ResponseWriter, r *http.Request) {
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
	propertyID := chi.URLParam(r, "propertyId")

	var dealID string
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT deal_id FROM tracked_properties WHERE id = $1`, propertyID,
	).Scan(&dealID); err != nil {
		http.Error(w, "property not found", http.StatusNotFound)
		return
	}
	if !h.checkDealAccess(r, dealID, userID) {
		http.Error(w, "property not found", http.StatusNotFound)
		return
	}

	h.db.ExecContext(r.Context(), `DELETE FROM tracked_properties WHERE id = $1`, propertyID)
	respond(w, http.StatusOK, map[string]string{"status": "ok"})
}
