import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function makeClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

let singleton: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  if (!singleton) singleton = makeClient();
  // Pin to globalThis in dev so HMR reuses one client; in prod the module-level
  // `singleton` already guarantees a single instance per server.
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = singleton;
  }
  return singleton;
}

// Lazy proxy: the real PrismaClient — and makeClient()'s DATABASE_URL check — is
// created on first property access, never at import. This lets `next build`
// import route modules (page-data collection) without a database connection
// string in the build environment; the client is constructed at runtime on the
// first query.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
});
