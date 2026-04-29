.PHONY: dev dev-backend dev-frontend db migrate tidy install

# Start both services in parallel
dev:
	@make -j2 dev-backend dev-frontend

dev-backend:
	cd backend && go run ./cmd/api

dev-frontend:
	cd frontend && npm run dev

# Spin up Postgres only
db:
	docker compose up postgres -d

# Apply all migrations (requires migrate CLI: brew install golang-migrate)
migrate:
	migrate -path backend/migrations -database "$(DATABASE_URL)" up

# Tidy Go dependencies
tidy:
	cd backend && go mod tidy

# Install frontend dependencies
install:
	cd frontend && npm install

# Build for production
build:
	cd backend && go build -o bin/api ./cmd/api
	cd frontend && npm run build
