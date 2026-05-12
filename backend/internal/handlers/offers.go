package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/lib/pq"
	"realtourflow/internal/middleware"
)

type offerRow struct {
	ID           string    `json:"id"`
	DealID       string    `json:"deal_id"`
	BuyerName    string    `json:"buyer_name"`
	OfferPrice   int       `json:"offer_price"`
	CloseDate    *string   `json:"close_date"`
	Contingencies []string `json:"contingencies"`
	AgentNotes   string    `json:"agent_notes"`
	SubmittedAt  time.Time `json:"submitted_at"`
	CreatedAt    time.Time `json:"created_at"`
}

func (h *Handler) ListOffers(w http.ResponseWriter, r *http.Request) {
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
		SELECT id, deal_id, buyer_name, offer_price, close_date::text,
		       contingencies, agent_notes, submitted_at, created_at
		FROM offers
		WHERE deal_id = $1
		ORDER BY submitted_at DESC
	`, dealID)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := make([]offerRow, 0)
	for rows.Next() {
		var o offerRow
		if err := rows.Scan(
			&o.ID, &o.DealID, &o.BuyerName, &o.OfferPrice, &o.CloseDate,
			pq.Array(&o.Contingencies), &o.AgentNotes, &o.SubmittedAt, &o.CreatedAt,
		); err != nil {
			http.Error(w, "scan error", http.StatusInternalServerError)
			return
		}
		result = append(result, o)
	}
	respond(w, http.StatusOK, result)
}

func (h *Handler) CreateOffer(w http.ResponseWriter, r *http.Request) {
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

	// Agent-only: must own the deal
	var ownerID string
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT agent_id FROM deals WHERE id = $1`, dealID,
	).Scan(&ownerID); err != nil || ownerID != userID {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	var req struct {
		BuyerName     string   `json:"buyer_name"`
		OfferPrice    int      `json:"offer_price"`
		CloseDate     *string  `json:"close_date"`
		Contingencies []string `json:"contingencies"`
		AgentNotes    string   `json:"agent_notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if req.Contingencies == nil {
		req.Contingencies = []string{}
	}

	var o offerRow
	err = h.db.QueryRowContext(r.Context(), `
		INSERT INTO offers (deal_id, buyer_name, offer_price, close_date, contingencies, agent_notes)
		VALUES ($1, $2, $3, $4::date, $5, $6)
		RETURNING id, deal_id, buyer_name, offer_price, close_date::text,
		          contingencies, agent_notes, submitted_at, created_at
	`, dealID, req.BuyerName, req.OfferPrice, req.CloseDate,
		pq.Array(req.Contingencies), req.AgentNotes,
	).Scan(
		&o.ID, &o.DealID, &o.BuyerName, &o.OfferPrice, &o.CloseDate,
		pq.Array(&o.Contingencies), &o.AgentNotes, &o.SubmittedAt, &o.CreatedAt,
	)
	if err != nil {
		http.Error(w, "failed to create offer", http.StatusInternalServerError)
		return
	}
	respond(w, http.StatusCreated, o)
}

func (h *Handler) DeleteOffer(w http.ResponseWriter, r *http.Request) {
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
	offerID := chi.URLParam(r, "offerId")

	var dealID string
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT deal_id FROM offers WHERE id = $1`, offerID,
	).Scan(&dealID); err != nil {
		http.Error(w, "offer not found", http.StatusNotFound)
		return
	}

	var ownerID string
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT agent_id FROM deals WHERE id = $1`, dealID,
	).Scan(&ownerID); err != nil || ownerID != userID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	h.db.ExecContext(r.Context(), `DELETE FROM offers WHERE id = $1`, offerID)
	respond(w, http.StatusOK, map[string]string{"status": "ok"})
}
