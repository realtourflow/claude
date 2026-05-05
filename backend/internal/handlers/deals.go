package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"realtourflow/internal/middleware"
	"realtourflow/internal/models"
)

// resolveUserID returns the DB UUID for the authenticated user.
func resolveUserID(ctx context.Context, db *sql.DB, auth0ID string) (string, error) {
	var id string
	err := db.QueryRowContext(ctx, `SELECT id FROM users WHERE auth0_id = $1`, auth0ID).Scan(&id)
	return id, err
}

// healthExpr is a reusable SQL CASE expression that computes deal health.
// Red  = any incomplete task with a past due_date.
// Yellow = deal has been in current stage longer than the stage threshold AND has incomplete tasks.
// Green  = everything else.
const healthExpr = `
CASE
  WHEN EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.deal_id = deals.id
      AND t.status NOT IN ('completed','skipped')
      AND t.due_date IS NOT NULL
      AND t.due_date < CURRENT_DATE
  ) THEN 'red'
  WHEN FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(
    (SELECT changed_at FROM deal_stage_history dsh
     WHERE dsh.deal_id = deals.id ORDER BY dsh.changed_at DESC LIMIT 1),
    deals.created_at
  ))) / 86400)::INT >
    CASE deals.stage
      WHEN 'intake'          THEN 5
      WHEN 'active_search'   THEN 30
      WHEN 'offer_active'    THEN 10
      WHEN 'under_contract'  THEN 35
      WHEN 'pre_close'       THEN 10
      WHEN 'closing'         THEN 5
      WHEN 'post_close'      THEN 21
      ELSE 30
    END
  AND EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.deal_id = deals.id AND t.status NOT IN ('completed','skipped')
  )
  THEN 'yellow'
  ELSE 'green'
END`

// ListDeals returns all deals for the authenticated agent.
func (h *Handler) ListDeals(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	userID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found — call /users/sync first", http.StatusNotFound)
		return
	}

	rows, err := h.db.QueryContext(r.Context(), `
		SELECT id, agent_id, type, stage, `+healthExpr+` AS health,
		       title, address, price, arive_linked, created_at, updated_at
		FROM deals
		WHERE agent_id = $1
		ORDER BY updated_at DESC
	`, userID)
	if err != nil {
		http.Error(w, "failed to fetch deals", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	deals := make([]*models.Deal, 0)
	for rows.Next() {
		d := &models.Deal{}
		if err := rows.Scan(
			&d.ID, &d.AgentID, &d.Type, &d.Stage, &d.Health,
			&d.Title, &d.Address, &d.Price, &d.AriveLinked, &d.CreatedAt, &d.UpdatedAt,
		); err != nil {
			http.Error(w, "failed to scan deal", http.StatusInternalServerError)
			return
		}
		deals = append(deals, d)
	}

	respond(w, http.StatusOK, deals)
}

// CreateDeal creates a new deal for the authenticated agent.
func (h *Handler) CreateDeal(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	userID, err := resolveUserID(r.Context(), h.db, claims.RegisteredClaims.Subject)
	if err != nil {
		http.Error(w, "user not found — call /users/sync first", http.StatusNotFound)
		return
	}

	var req struct {
		Title       string          `json:"title"`
		Type        models.DealType `json:"type"`
		Address     *string         `json:"address"`
		Price       *float64        `json:"price"`
		AriveLinked bool            `json:"arive_linked"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Title == "" || (req.Type != models.DealTypeBuy && req.Type != models.DealTypeSell) {
		http.Error(w, "title and type (buy|sell) are required", http.StatusBadRequest)
		return
	}

	// New deals are always green — no tasks, no stage history yet.
	deal := &models.Deal{Health: "green"}
	err = h.db.QueryRowContext(r.Context(), `
		INSERT INTO deals (agent_id, type, title, address, price, arive_linked)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, agent_id, type, stage, title, address, price, arive_linked, created_at, updated_at
	`, userID, req.Type, req.Title, req.Address, req.Price, req.AriveLinked).Scan(
		&deal.ID, &deal.AgentID, &deal.Type, &deal.Stage, &deal.Title,
		&deal.Address, &deal.Price, &deal.AriveLinked, &deal.CreatedAt, &deal.UpdatedAt,
	)
	if err != nil {
		http.Error(w, "failed to create deal", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusCreated, deal)
}

// GetDeal returns a single deal by ID.
func (h *Handler) GetDeal(w http.ResponseWriter, r *http.Request) {
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

	deal := &models.Deal{}
	err = h.db.QueryRowContext(r.Context(), `
		SELECT id, agent_id, type, stage, `+healthExpr+` AS health,
		       title, address, price, arive_linked, created_at, updated_at
		FROM deals
		WHERE id = $1 AND agent_id = $2
	`, dealID, userID).Scan(
		&deal.ID, &deal.AgentID, &deal.Type, &deal.Stage, &deal.Health,
		&deal.Title, &deal.Address, &deal.Price, &deal.AriveLinked, &deal.CreatedAt, &deal.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to fetch deal", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusOK, deal)
}

// AdvanceStage moves a deal to the next stage and records history.
func (h *Handler) AdvanceStage(w http.ResponseWriter, r *http.Request) {
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

	var req struct {
		Stage models.DealStage `json:"stage"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	tx, err := h.db.BeginTx(r.Context(), nil)
	if err != nil {
		http.Error(w, "failed to begin transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	var currentStage models.DealStage
	err = tx.QueryRowContext(r.Context(),
		`SELECT stage FROM deals WHERE id = $1 AND agent_id = $2`, dealID, userID,
	).Scan(&currentStage)
	if err == sql.ErrNoRows {
		http.Error(w, "deal not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to fetch deal", http.StatusInternalServerError)
		return
	}

	_, err = tx.ExecContext(r.Context(), `
		UPDATE deals SET stage = $1, updated_at = NOW() WHERE id = $2
	`, req.Stage, dealID)
	if err != nil {
		http.Error(w, "failed to update stage", http.StatusInternalServerError)
		return
	}

	_, err = tx.ExecContext(r.Context(), `
		INSERT INTO deal_stage_history (deal_id, from_stage, to_stage, changed_by)
		VALUES ($1, $2, $3, $4)
	`, dealID, currentStage, req.Stage, userID)
	if err != nil {
		http.Error(w, "failed to record stage history", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "failed to commit", http.StatusInternalServerError)
		return
	}

	// Re-fetch with health score now that stage history is committed.
	deal := &models.Deal{}
	err = h.db.QueryRowContext(r.Context(), `
		SELECT id, agent_id, type, stage, `+healthExpr+` AS health,
		       title, address, price, arive_linked, created_at, updated_at
		FROM deals
		WHERE id = $1
	`, dealID).Scan(
		&deal.ID, &deal.AgentID, &deal.Type, &deal.Stage, &deal.Health,
		&deal.Title, &deal.Address, &deal.Price, &deal.AriveLinked, &deal.CreatedAt, &deal.UpdatedAt,
	)
	if err != nil {
		http.Error(w, "failed to fetch updated deal", http.StatusInternalServerError)
		return
	}

	respond(w, http.StatusOK, deal)
}
