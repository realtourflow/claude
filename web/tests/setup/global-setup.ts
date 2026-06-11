/**
 * Vitest globalSetup. Creates a fresh test database against the local
 * Postgres (the docker-compose `clauderealtourflow-postgres-1` container)
 * and runs the golang-migrate migrations into it. Exposes DATABASE_URL
 * via env so every test file (and the Prisma client) sees the same DB.
 *
 * Why not Testcontainers: vitest+Node 25 hangs on Testcontainers init.
 * Reusing the already-running local Postgres is faster and works around
 * the issue.
 *
 * Test files truncate user-data tables in beforeEach via `truncateAll()`
 * from tests/helpers/db.ts — schema-bearing tables are preserved.
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable";

const TEST_DB_NAME =
  process.env.TEST_DATABASE_NAME ?? "realtourflow_test";

const TEST_URL = `postgres://postgres:postgres@localhost:5432/${TEST_DB_NAME}?sslmode=disable`;

export async function setup(): Promise<void> {
  // Drop and recreate the test DB so every run starts clean.
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
  } finally {
    await admin.end();
  }

  // Apply the golang-migrate schema (single source of truth until Phase 12).
  const migrationsPath = path.resolve(__dirname, "../../../migrations");
  execSync(
    `migrate -path "${migrationsPath}" -database "${TEST_URL}" up`,
    { stdio: "inherit" }
  );

  // Prisma 7's adapter takes the connection string at client-construction
  // time, so this env var must be set before lib/db.ts is imported.
  process.env.DATABASE_URL = TEST_URL;
  process.env.TEST_DATABASE_URL = TEST_URL;
}

export async function teardown(): Promise<void> {
  // Leave the test DB in place between runs — drops happen at the start of
  // each run, which is faster than dropping in teardown.
}
