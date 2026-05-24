import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "./env";

export class AuthError extends Error {
  readonly status: 401 | 403;
  constructor(message: string, status: 401 | 403 = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export type AuthClaims = {
  sub: string;
  roles: string[];
};

type JWKSet = (
  protectedHeader?: Parameters<Awaited<ReturnType<typeof createRemoteJWKSet>>>[0],
  token?: Parameters<Awaited<ReturnType<typeof createRemoteJWKSet>>>[1]
) => Promise<CryptoKey>;

export type VerifyOptions = {
  jwks: JWKSet;
  issuer: string;
  audience: string;
};

const ROLE_CLAIM = "https://realtourflow.com/roles";

let defaultOpts: VerifyOptions | undefined;

function getDefaultOpts(): VerifyOptions {
  if (defaultOpts) return defaultOpts;
  const e = env();
  const issuer = `https://${e.AUTH0_DOMAIN}/`;
  const jwks = createRemoteJWKSet(
    new URL(`${issuer}.well-known/jwks.json`)
  ) as unknown as JWKSet;
  defaultOpts = { jwks, issuer, audience: e.AUTH0_AUDIENCE };
  return defaultOpts;
}

function extractRoles(payload: JWTPayload): string[] {
  const raw = (payload as Record<string, unknown>)[ROLE_CLAIM];
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is string => typeof r === "string");
}

export async function verifyToken(
  token: string,
  opts?: VerifyOptions
): Promise<AuthClaims> {
  const o = opts ?? getDefaultOpts();
  try {
    const { payload } = await jwtVerify(token, o.jwks, {
      issuer: o.issuer,
      audience: o.audience,
      algorithms: ["RS256"],
      clockTolerance: 60,
    });
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    if (!sub) {
      throw new AuthError("token missing sub claim", 401);
    }
    return { sub, roles: extractRoles(payload) };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError(
      `token verification failed: ${(err as Error).message}`,
      401
    );
  }
}

export async function verifyAuth0Jwt(
  req: Request,
  opts?: VerifyOptions
): Promise<AuthClaims> {
  const header =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) {
    throw new AuthError("missing Authorization header", 401);
  }
  const match = /^bearer\s+(.+)$/i.exec(header);
  if (!match) {
    throw new AuthError("Authorization header must use Bearer scheme", 401);
  }
  const token = match[1].trim();
  if (!token) {
    throw new AuthError("empty Bearer token", 401);
  }
  return verifyToken(token, opts);
}
