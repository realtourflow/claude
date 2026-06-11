// Loads .env.test if present, then falls back to .env. Vitest setup file.
import "dotenv/config";
// Extend Vitest's expect with @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
import "@testing-library/jest-dom/vitest";
import { afterAll } from "vitest";

// Any test that drives a deal-stage or task mutation now lazily starts the
// pg-boss singleton (durable calendar queue, lib/queue.ts) inside this worker
// — its pg pool + supervision timer would keep the worker alive after the
// file finishes. Stop it unconditionally; it's a no-op when never started.
afterAll(async () => {
  const { stopBossForTesting } = await import("@/lib/queue");
  await stopBossForTesting();
});
