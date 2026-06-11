import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "node:child_process";
import path from "node:path";

let started: StartedPostgreSqlContainer | undefined;
let dbUrl: string | undefined;

/**
 * Boots an ephemeral Postgres container, runs the SQL migrations
 * via golang-migrate (which is the source of truth for schema), and returns
 * the connection URL. Call once per test suite via `beforeAll`.
 *
 * Why golang-migrate and not `prisma migrate`: the SQL migrations in
 * migrations/ are authoritative. A future cutover may switch to Prisma
 * migrations.
 */
export async function startTestDb(): Promise<string> {
  if (dbUrl) return dbUrl;

  started = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("realtourflow_test")
    .withUsername("postgres")
    .withPassword("postgres")
    .start();

  const url = started.getConnectionUri();
  const migrationsPath = path.resolve(__dirname, "../../../migrations");

  // Run migrations via golang-migrate CLI (must be installed on the host: `brew install golang-migrate`).
  execSync(
    `migrate -path "${migrationsPath}" -database "${url}?sslmode=disable" up`,
    { stdio: "inherit" }
  );

  dbUrl = url;
  process.env.DATABASE_URL = url;
  return url;
}

export async function stopTestDb(): Promise<void> {
  if (started) {
    await started.stop();
    started = undefined;
    dbUrl = undefined;
  }
}
