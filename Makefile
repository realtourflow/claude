.PHONY: dev db migrate install build test typecheck lint

# Start the Next.js app (API + UI together)
dev:
	cd web && npm run dev

# Spin up local Postgres
db:
	docker compose up postgres -d

# Apply all migrations to the database pointed at by $DATABASE_URL.
# golang-migrate against the SQL files in migrations/ (the schema source of
# truth). A future cutover may switch this to `prisma migrate deploy`.
migrate:
	migrate -path migrations -database "$(DATABASE_URL)" up

# Install web dependencies
install:
	cd web && npm install

# Production build
build:
	cd web && npm run build

# Tests
test:
	cd web && npm test

typecheck:
	cd web && npm run typecheck

lint:
	cd web && npm run lint
