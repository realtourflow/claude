package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/checkout/session"
	"github.com/stripe/stripe-go/v82/webhook"
	"realtourflow/internal/middleware"
)

const closingFeeAmountCents = 7500 // $75.00

// FeeCheckout creates a Stripe Checkout Session for the $75 closing fee.
// POST /deals/:dealId/fee/checkout
// Returns { "checkout_url": "https://checkout.stripe.com/..." }
func (h *Handler) FeeCheckout(w http.ResponseWriter, r *http.Request) {
	if h.stripeKey == "" {
		http.Error(w, "stripe not configured", http.StatusServiceUnavailable)
		return
	}

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

	// Load deal — verify ownership and check fee status.
	var agentID, feeStatus, dealTitle string
	err = h.db.QueryRowContext(r.Context(),
		`SELECT agent_id, fee_status, title FROM deals WHERE id = $1`,
		dealID,
	).Scan(&agentID, &feeStatus, &dealTitle)
	if err == sql.ErrNoRows {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	if agentID != userID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if feeStatus == "paid" || feeStatus == "waived" {
		http.Error(w, "fee already settled", http.StatusConflict)
		return
	}

	stripe.Key = h.stripeKey

	successURL := fmt.Sprintf("https://claude-pi-lime.vercel.app/agent/deals/%s?fee=paid", dealID)
	cancelURL := fmt.Sprintf("https://claude-pi-lime.vercel.app/agent/deals/%s?fee=cancelled", dealID)

	params := &stripe.CheckoutSessionParams{
		PaymentMethodTypes: stripe.StringSlice([]string{"card"}),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
					Currency: stripe.String("usd"),
					ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
						Name:        stripe.String("RealTour Flow Closing Fee"),
						Description: stripe.String(fmt.Sprintf("Closing fee for deal: %s", dealTitle)),
					},
					UnitAmount: stripe.Int64(closingFeeAmountCents),
				},
				Quantity: stripe.Int64(1),
			},
		},
		Mode:       stripe.String(string(stripe.CheckoutSessionModePayment)),
		SuccessURL: stripe.String(successURL),
		CancelURL:  stripe.String(cancelURL),
		Metadata: map[string]string{
			"deal_id": dealID,
			"type":    "closing_fee",
		},
	}

	sess, err := session.New(params)
	if err != nil {
		log.Printf("stripe checkout create error: %v", err)
		http.Error(w, "failed to create checkout session", http.StatusInternalServerError)
		return
	}

	// Mark fee as pending so admin can see it's in-flight.
	_, _ = h.db.ExecContext(r.Context(),
		`UPDATE deals SET fee_status = 'pending', fee_checkout_session_id = $1 WHERE id = $2`,
		sess.ID, dealID,
	)

	respond(w, http.StatusOK, map[string]string{"checkout_url": sess.URL})
}

// StripeWebhook handles incoming events from Stripe.
// POST /stripe/webhook  (public — no Auth0, but verified via webhook signature)
func (h *Handler) StripeWebhook(w http.ResponseWriter, r *http.Request) {
	if h.stripeWebhookSecret == "" {
		http.Error(w, "stripe not configured", http.StatusServiceUnavailable)
		return
	}

	const maxBodyBytes = 65536
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	payload, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body failed", http.StatusBadRequest)
		return
	}

	event, err := webhook.ConstructEvent(payload, r.Header.Get("Stripe-Signature"), h.stripeWebhookSecret)
	if err != nil {
		log.Printf("stripe webhook signature error: %v", err)
		http.Error(w, "invalid signature", http.StatusBadRequest)
		return
	}

	switch event.Type {
	case "checkout.session.completed":
		var sess stripe.CheckoutSession
		if err := json.Unmarshal(event.Data.Raw, &sess); err != nil {
			http.Error(w, "parse session failed", http.StatusBadRequest)
			return
		}
		if sess.PaymentStatus != stripe.CheckoutSessionPaymentStatusPaid {
			// Not paid yet (e.g. bank transfer pending) — wait for payment_intent.succeeded.
			break
		}
		dealID := sess.Metadata["deal_id"]
		if dealID == "" {
			break
		}
		switch sess.Metadata["type"] {
		case "fast_pass":
			if err := h.markFastPassPaid(dealID); err != nil {
				log.Printf("mark fast_pass paid error for deal %s: %v", dealID, err)
			}
		default:
			if err := h.markFeePaid(dealID, sess.ID); err != nil {
				log.Printf("mark fee paid error for deal %s: %v", dealID, err)
			}
		}

	case "payment_intent.succeeded":
		// Covers async payment methods.
		var pi stripe.PaymentIntent
		if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
			break
		}
		dealID := pi.Metadata["deal_id"]
		if dealID != "" {
			if err := h.markFeePaid(dealID, pi.ID); err != nil {
				log.Printf("mark fee paid (payment_intent) error for deal %s: %v", dealID, err)
			}
		}
	}

	w.WriteHeader(http.StatusOK)
}

func (h *Handler) markFeePaid(dealID, sessionID string) error {
	_, err := h.db.Exec(
		`UPDATE deals
		 SET fee_status = 'paid',
		     fee_checkout_session_id = $1,
		     fee_paid_at = $2
		 WHERE id = $3 AND fee_status != 'waived'`,
		sessionID, time.Now().UTC(), dealID,
	)
	return err
}

func (h *Handler) markFastPassPaid(dealID string) error {
	_, err := h.db.Exec(
		`UPDATE deals
		 SET fast_pass = jsonb_set(COALESCE(fast_pass, '{}'::jsonb), '{status}', '"active"')
		 WHERE id = $1`,
		dealID,
	)
	return err
}

// WaiveFee allows an admin to waive the closing fee for a deal.
// POST /deals/:dealId/fee/waive
func (h *Handler) WaiveFee(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	isAdmin := false
	for _, role := range middleware.GetRoles(r) {
		if role == "admin" {
			isAdmin = true
			break
		}
	}
	if !isAdmin {
		http.Error(w, "admin only", http.StatusForbidden)
		return
	}

	dealID := chi.URLParam(r, "dealId")
	_, err := h.db.ExecContext(r.Context(),
		`UPDATE deals SET fee_status = 'waived' WHERE id = $1`, dealID,
	)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	respond(w, http.StatusOK, map[string]string{"status": "waived"})

	if actorID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject); err == nil {
		h.logAudit(&actorID, "fee_waive", &dealID, nil, nil)
	}
}
