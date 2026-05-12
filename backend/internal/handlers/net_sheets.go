package handlers

import (
	"encoding/json"
	"math"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"realtourflow/internal/middleware"
)

// ─── Types ────────────────────────────────────────────────────────────────────

type netSheetLine struct {
	ID            string   `json:"id"`
	Label         string   `json:"label"`
	Category      string   `json:"category"`
	Amount        float64  `json:"amount"`
	Pct           *float64 `json:"pct,omitempty"`
	IsPct         bool     `json:"is_pct"`
	Required      bool     `json:"required"`
	Enabled       bool     `json:"enabled"`
	Editable      bool     `json:"editable"`
	AutoPopulated bool     `json:"auto_populated"`
}

type netSheet struct {
	ID          string          `json:"id"`
	DealID      string          `json:"deal_id"`
	SalePrice   int             `json:"sale_price"`
	ClosingDate *string         `json:"closing_date"`
	AnnualTaxes int             `json:"annual_taxes"`
	Lines       json.RawMessage `json:"lines"`
	Status      string          `json:"status"`
	ReadyAt     *time.Time      `json:"ready_at"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

type agentCommissionSettings struct {
	IsPct  bool     `json:"is_pct"`
	Pct    *float64 `json:"pct"`
	Amount *float64 `json:"amount"`
}

type agentNetSheetSettings struct {
	BuyerCommission  *agentCommissionSettings `json:"buyer_commission"`
	SellerCommission *agentCommissionSettings `json:"seller_commission"`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func pf(v float64) *float64 { return &v }

func commissionLine(id, label string, salePrice int, comm *agentCommissionSettings) netSheetLine {
	line := netSheetLine{
		ID:            id,
		Label:         label,
		Category:      "commission",
		Required:      true,
		Enabled:       true,
		Editable:      true,
		AutoPopulated: comm != nil,
	}
	if comm == nil {
		pct := 3.0
		line.Pct = &pct
		line.IsPct = true
		line.Amount = math.Round(float64(salePrice) * 0.03)
		return line
	}
	if comm.IsPct && comm.Pct != nil {
		line.IsPct = true
		line.Pct = comm.Pct
		line.Amount = math.Round(float64(salePrice) * (*comm.Pct / 100))
	} else if !comm.IsPct && comm.Amount != nil {
		line.IsPct = false
		line.Amount = *comm.Amount
	} else {
		pct := 3.0
		line.Pct = &pct
		line.IsPct = true
		line.Amount = math.Round(float64(salePrice) * 0.03)
	}
	return line
}

func optionalLine(id, label, category string) netSheetLine {
	return netSheetLine{
		ID: id, Label: label, Category: category,
		Amount: 0, IsPct: false, Required: false,
		Enabled: false, Editable: true, AutoPopulated: false,
	}
}

func buildDefaultLines(dealType string, salePrice int, settings *agentNetSheetSettings) []netSheetLine {
	transferTaxPct := 0.1
	transferTax := math.Round(float64(salePrice) * 0.001)

	var commSettings *agentNetSheetSettings
	if settings != nil {
		commSettings = settings
	}

	required := func(id, label, category string, amount float64) netSheetLine {
		return netSheetLine{
			ID: id, Label: label, Category: category,
			Amount: amount, IsPct: false, Required: true,
			Enabled: true, Editable: true, AutoPopulated: false,
		}
	}

	var lines []netSheetLine

	if dealType == "sell" {
		var buyerComm, sellerComm *agentCommissionSettings
		if commSettings != nil {
			buyerComm = commSettings.BuyerCommission
			sellerComm = commSettings.SellerCommission
		}
		lines = []netSheetLine{
			commissionLine("listing_commission", "Listing Agent Commission", salePrice, sellerComm),
			commissionLine("buyers_agent_commission", "Buyer's Agent Commission", salePrice, buyerComm),
			required("title_closing_fee", "Title & Closing Fee", "title", 0),
			{
				ID: "transfer_taxes", Label: "Transfer Taxes", Category: "taxes",
				Amount: transferTax, Pct: &transferTaxPct, IsPct: true,
				Required: true, Enabled: true, Editable: true, AutoPopulated: true,
			},
			{
				ID: "property_tax_proration", Label: "Property Tax Proration", Category: "proration",
				Amount: 0, IsPct: false, Required: true, Enabled: true, Editable: true, AutoPopulated: false,
			},
			optionalLine("mortgage_payoff", "Mortgage Payoff", "payoff"),
			optionalLine("seller_concessions", "Seller Concessions", "optional"),
			optionalLine("repair_credits", "Repair Credits", "optional"),
			optionalLine("termite", "Termite Inspection", "optional"),
			optionalLine("septic", "Septic Clean Out", "optional"),
			optionalLine("home_warranty", "Home Warranty", "optional"),
			optionalLine("hoa_payoff", "HOA Payoff", "optional"),
			optionalLine("survey", "Survey", "optional"),
		}
	} else {
		// buy deal — closing cost estimate
		var buyerComm *agentCommissionSettings
		if commSettings != nil {
			buyerComm = commSettings.BuyerCommission
		}
		lines = []netSheetLine{
			commissionLine("buyers_agent_commission", "Buyer's Agent Commission", salePrice, buyerComm),
			required("title_closing_fee", "Title & Closing Fee", "title", 0),
			{
				ID: "transfer_taxes", Label: "Transfer Taxes", Category: "taxes",
				Amount: transferTax, Pct: &transferTaxPct, IsPct: true,
				Required: true, Enabled: true, Editable: true, AutoPopulated: true,
			},
			{
				ID: "property_tax_proration", Label: "Property Tax Proration", Category: "proration",
				Amount: 0, IsPct: false, Required: true, Enabled: true, Editable: true, AutoPopulated: false,
			},
			optionalLine("appraisal", "Appraisal", "optional"),
			optionalLine("termite", "Termite Inspection", "optional"),
			optionalLine("septic", "Septic Clean Out", "optional"),
			optionalLine("hoa_dues", "HOA Dues (First Month)", "optional"),
		}
	}
	return lines
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

// GetOrCreateNetSheet — GET /deals/:dealId/net-sheet
// Agents always get it; participants only see it when status = 'ready'.
func (h *Handler) GetOrCreateNetSheet(w http.ResponseWriter, r *http.Request) {
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

	// Resolve deal + check access
	var dealType string
	var dealPrice int
	var ownerID string
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT type, COALESCE(price, 0), agent_id FROM deals WHERE id = $1`, dealID,
	).Scan(&dealType, &dealPrice, &ownerID); err != nil {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	isAgent := ownerID == userID
	if !isAgent {
		// Must be a participant
		if !h.checkDealAccess(r, dealID, userID) {
			http.Error(w, "deal not found", http.StatusNotFound)
			return
		}
	}

	// Try to fetch existing sheet
	var ns netSheet
	err = h.db.QueryRowContext(r.Context(), `
		SELECT id, deal_id, sale_price, closing_date::text, annual_taxes,
		       lines, status, ready_at, created_at, updated_at
		FROM net_sheets WHERE deal_id = $1
	`, dealID).Scan(
		&ns.ID, &ns.DealID, &ns.SalePrice, &ns.ClosingDate, &ns.AnnualTaxes,
		&ns.Lines, &ns.Status, &ns.ReadyAt, &ns.CreatedAt, &ns.UpdatedAt,
	)
	if err == nil {
		// Participants only see ready sheets
		if !isAgent && ns.Status != "ready" {
			http.Error(w, "net sheet not ready", http.StatusForbidden)
			return
		}
		respond(w, http.StatusOK, ns)
		return
	}

	// Doesn't exist — auto-create (agent only can trigger creation)
	if !isAgent {
		http.Error(w, "net sheet not ready", http.StatusForbidden)
		return
	}

	// Fetch agent commission settings
	var settingsRaw []byte
	h.db.QueryRowContext(r.Context(),
		`SELECT settings FROM user_settings WHERE user_id = $1`, ownerID,
	).Scan(&settingsRaw)

	var commSettings *agentNetSheetSettings
	if settingsRaw != nil {
		var s agentNetSheetSettings
		if json.Unmarshal(settingsRaw, &s) == nil {
			commSettings = &s
		}
	}

	lines := buildDefaultLines(dealType, dealPrice, commSettings)
	linesJSON, _ := json.Marshal(lines)

	err = h.db.QueryRowContext(r.Context(), `
		INSERT INTO net_sheets (deal_id, sale_price, lines)
		VALUES ($1, $2, $3)
		RETURNING id, deal_id, sale_price, closing_date::text, annual_taxes,
		          lines, status, ready_at, created_at, updated_at
	`, dealID, dealPrice, linesJSON).Scan(
		&ns.ID, &ns.DealID, &ns.SalePrice, &ns.ClosingDate, &ns.AnnualTaxes,
		&ns.Lines, &ns.Status, &ns.ReadyAt, &ns.CreatedAt, &ns.UpdatedAt,
	)
	if err != nil {
		http.Error(w, "failed to create net sheet", http.StatusInternalServerError)
		return
	}
	respond(w, http.StatusCreated, ns)
}

// PutNetSheet — PUT /deals/:dealId/net-sheet — agent-only full replace.
func (h *Handler) PutNetSheet(w http.ResponseWriter, r *http.Request) {
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

	var ownerID string
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT agent_id FROM deals WHERE id = $1`, dealID,
	).Scan(&ownerID); err != nil || ownerID != userID {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	var req struct {
		SalePrice   int             `json:"sale_price"`
		ClosingDate *string         `json:"closing_date"`
		AnnualTaxes int             `json:"annual_taxes"`
		Lines       json.RawMessage `json:"lines"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	var ns netSheet
	err = h.db.QueryRowContext(r.Context(), `
		INSERT INTO net_sheets (deal_id, sale_price, closing_date, annual_taxes, lines)
		VALUES ($1, $2, $3::date, $4, $5)
		ON CONFLICT (deal_id) DO UPDATE SET
		  sale_price   = EXCLUDED.sale_price,
		  closing_date = EXCLUDED.closing_date,
		  annual_taxes = EXCLUDED.annual_taxes,
		  lines        = EXCLUDED.lines,
		  updated_at   = NOW()
		RETURNING id, deal_id, sale_price, closing_date::text, annual_taxes,
		          lines, status, ready_at, created_at, updated_at
	`, dealID, req.SalePrice, req.ClosingDate, req.AnnualTaxes, req.Lines).Scan(
		&ns.ID, &ns.DealID, &ns.SalePrice, &ns.ClosingDate, &ns.AnnualTaxes,
		&ns.Lines, &ns.Status, &ns.ReadyAt, &ns.CreatedAt, &ns.UpdatedAt,
	)
	if err != nil {
		http.Error(w, "failed to save net sheet", http.StatusInternalServerError)
		return
	}
	respond(w, http.StatusOK, ns)
}

// MarkNetSheetReady — POST /deals/:dealId/net-sheet/ready — agent-only.
func (h *Handler) MarkNetSheetReady(w http.ResponseWriter, r *http.Request) {
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

	var ownerID string
	if err := h.db.QueryRowContext(r.Context(),
		`SELECT agent_id FROM deals WHERE id = $1`, dealID,
	).Scan(&ownerID); err != nil || ownerID != userID {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}

	var req struct {
		Ready bool `json:"ready"` // false = revert to draft
	}
	json.NewDecoder(r.Body).Decode(&req)

	var ns netSheet
	if req.Ready {
		err = h.db.QueryRowContext(r.Context(), `
			UPDATE net_sheets SET status = 'ready', ready_at = NOW(), updated_at = NOW()
			WHERE deal_id = $1
			RETURNING id, deal_id, sale_price, closing_date::text, annual_taxes,
			          lines, status, ready_at, created_at, updated_at
		`, dealID).Scan(
			&ns.ID, &ns.DealID, &ns.SalePrice, &ns.ClosingDate, &ns.AnnualTaxes,
			&ns.Lines, &ns.Status, &ns.ReadyAt, &ns.CreatedAt, &ns.UpdatedAt,
		)
	} else {
		err = h.db.QueryRowContext(r.Context(), `
			UPDATE net_sheets SET status = 'draft', ready_at = NULL, updated_at = NOW()
			WHERE deal_id = $1
			RETURNING id, deal_id, sale_price, closing_date::text, annual_taxes,
			          lines, status, ready_at, created_at, updated_at
		`, dealID).Scan(
			&ns.ID, &ns.DealID, &ns.SalePrice, &ns.ClosingDate, &ns.AnnualTaxes,
			&ns.Lines, &ns.Status, &ns.ReadyAt, &ns.CreatedAt, &ns.UpdatedAt,
		)
	}
	if err != nil {
		http.Error(w, "net sheet not found", http.StatusNotFound)
		return
	}
	respond(w, http.StatusOK, ns)
}
