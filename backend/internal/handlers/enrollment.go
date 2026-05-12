package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/checkout/session"
	"realtourflow/internal/middleware"
)

// EnrollFastPass — POST /deals/:dealId/fastpass
// Stores enrollment JSONB on the deal. If payment_option === "now", creates a
// Stripe Checkout session and returns {checkout_url}. Otherwise returns {ok:true}.
func (h *Handler) EnrollFastPass(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	dealID := chi.URLParam(r, "dealId")
	userID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	var agentID, dealTitle string
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT agent_id, title FROM deals WHERE id = $1`, dealID,
	).Scan(&agentID, &dealTitle); err != nil {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}
	if agentID != userID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var req struct {
		PaymentOption   string          `json:"payment_option"` // now | at_closing | seller_concession
		SelectedUpsells []string        `json:"selected_upsells"`
		TotalCents      int             `json:"total_cents"`
		SurveyAnswers   json.RawMessage `json:"survey_answers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	status := "active"
	if req.PaymentOption == "now" {
		status = "pending_payment"
	}

	enrollment := map[string]interface{}{
		"status":           status,
		"payment_option":   req.PaymentOption,
		"selected_upsells": req.SelectedUpsells,
		"total_cents":      req.TotalCents,
		"survey_answers":   req.SurveyAnswers,
		"enrolled_at":      time.Now().UTC().Format(time.RFC3339),
	}

	if req.PaymentOption == "now" && h.stripeKey != "" {
		stripe.Key = h.stripeKey

		successURL := fmt.Sprintf("https://claude-pi-lime.vercel.app/agent/deals/%s?fastpass=paid", dealID)
		cancelURL := fmt.Sprintf("https://claude-pi-lime.vercel.app/agent/deals/%s", dealID)

		params := &stripe.CheckoutSessionParams{
			PaymentMethodTypes: stripe.StringSlice([]string{"card"}),
			Mode:               stripe.String(string(stripe.CheckoutSessionModePayment)),
			LineItems: []*stripe.CheckoutSessionLineItemParams{
				{
					PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
						Currency: stripe.String("usd"),
						ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
							Name:        stripe.String("Fast Pass Concierge Service"),
							Description: stripe.String(fmt.Sprintf("Fast Pass enrollment for %s", dealTitle)),
						},
						UnitAmount: stripe.Int64(int64(req.TotalCents)),
					},
					Quantity: stripe.Int64(1),
				},
			},
			SuccessURL: stripe.String(successURL),
			CancelURL:  stripe.String(cancelURL),
			Metadata: map[string]string{
				"deal_id": dealID,
				"type":    "fast_pass",
			},
		}

		sess, err := session.New(params)
		if err != nil {
			log.Printf("fast pass stripe checkout error: %v", err)
			http.Error(w, "failed to create checkout session", http.StatusInternalServerError)
			return
		}
		enrollment["checkout_session_id"] = sess.ID

		enrollJSON, _ := json.Marshal(enrollment)
		if _, err := h.db.ExecContext(r.Context(),
			`UPDATE deals SET fast_pass = $1, updated_at = NOW() WHERE id = $2`,
			enrollJSON, dealID,
		); err != nil {
			http.Error(w, "failed to save enrollment", http.StatusInternalServerError)
			return
		}

		respond(w, http.StatusOK, map[string]string{"checkout_url": sess.URL})
		return
	}

	enrollJSON, _ := json.Marshal(enrollment)
	if _, err := h.db.ExecContext(r.Context(),
		`UPDATE deals SET fast_pass = $1, updated_at = NOW() WHERE id = $2`,
		enrollJSON, dealID,
	); err != nil {
		http.Error(w, "failed to save enrollment", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusOK, map[string]bool{"ok": true})
}

// EnrollSmoothExit — POST /deals/:dealId/smoothexit
// Stores Smooth Exit enrollment JSONB on the deal. No immediate Stripe payment
// (both payment options — from_proceeds and buyer_concession — settle at closing).
func (h *Handler) EnrollSmoothExit(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	dealID := chi.URLParam(r, "dealId")
	userID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	var agentID string
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT agent_id FROM deals WHERE id = $1`, dealID,
	).Scan(&agentID); err != nil {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}
	if agentID != userID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var req struct {
		PaymentOption      string          `json:"payment_option"` // from_proceeds | buyer_concession
		EstimatedSalePrice int             `json:"estimated_sale_price"`
		FeeCents           int             `json:"fee_cents"`
		SurveyAnswers      json.RawMessage `json:"survey_answers"`
		SelectedUpsells    []string        `json:"selected_upsells"`
		UpsellTotalCents   int             `json:"upsell_total_cents"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.SelectedUpsells == nil {
		req.SelectedUpsells = []string{}
	}

	enrollment := map[string]interface{}{
		"status":               "active",
		"payment_option":       req.PaymentOption,
		"estimated_sale_price": req.EstimatedSalePrice,
		"fee_cents":            req.FeeCents,
		"survey_answers":       req.SurveyAnswers,
		"selected_upsells":     req.SelectedUpsells,
		"upsell_total_cents":   req.UpsellTotalCents,
		"upsells_paid":         false,
		"enrolled_at":          time.Now().UTC().Format(time.RFC3339),
	}

	enrollJSON, _ := json.Marshal(enrollment)
	if _, err := h.db.ExecContext(r.Context(),
		`UPDATE deals SET smooth_exit = $1, updated_at = NOW() WHERE id = $2`,
		enrollJSON, dealID,
	); err != nil {
		http.Error(w, "failed to save enrollment", http.StatusInternalServerError)
		return
	}

	// If upsells were selected, charge them upfront via Stripe.
	if req.UpsellTotalCents > 0 && h.stripeKey != "" {
		stripe.Key = h.stripeKey

		var dealTitle string
		h.db.QueryRowContext(r.Context(), `SELECT title FROM deals WHERE id = $1`, dealID).Scan(&dealTitle)

		successURL := fmt.Sprintf("%s/smooth-exit/complete?deal_id=%s&upsells=paid", h.frontendURL, dealID)
		cancelURL := fmt.Sprintf("%s/smooth-exit/survey?deal_id=%s&cancelled=1", h.frontendURL, dealID)

		params := &stripe.CheckoutSessionParams{
			PaymentMethodTypes: stripe.StringSlice([]string{"card"}),
			LineItems: []*stripe.CheckoutSessionLineItemParams{
				{
					PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
						Currency: stripe.String("usd"),
						ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
							Name:        stripe.String("Smooth Exit Add-ons"),
							Description: stripe.String(fmt.Sprintf("Concierge add-ons for: %s", dealTitle)),
						},
						UnitAmount: stripe.Int64(int64(req.UpsellTotalCents)),
					},
					Quantity: stripe.Int64(1),
				},
			},
			Mode:       stripe.String(string(stripe.CheckoutSessionModePayment)),
			SuccessURL: stripe.String(successURL),
			CancelURL:  stripe.String(cancelURL),
			Metadata: map[string]string{
				"deal_id": dealID,
				"type":    "smooth_exit_upsell",
			},
		}

		sess, err := session.New(params)
		if err != nil {
			log.Printf("stripe smooth exit upsell checkout error: %v", err)
			// Enrollment already saved — just return ok without checkout url.
			respond(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}

		respond(w, http.StatusOK, map[string]string{"ok": "true", "checkout_url": sess.URL})
		return
	}

	respond(w, http.StatusOK, map[string]bool{"ok": true})
}
