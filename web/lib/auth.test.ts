import { describe, it, expect, beforeAll } from "vitest";
import {
  SignJWT,
  generateKeyPair,
  exportJWK,
  createLocalJWKSet,
  type JWK,
  type KeyObject,
} from "jose";
import { AuthError, verifyToken, verifyAuth0Jwt } from "@/lib/auth";

const ISSUER = "https://test.auth0.local/";
const AUDIENCE = "https://api.test.local";
const ROLE_CLAIM = "https://realtourflow.com/roles";

let privateKey: KeyObject;
let publicJwk: JWK;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  privateKey = kp.privateKey as KeyObject;
  publicJwk = await exportJWK(kp.publicKey);
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  jwks = createLocalJWKSet({ keys: [publicJwk] });
});

async function sign(payload: Record<string, unknown>, opts: { issuer?: string; audience?: string; expiresIn?: string } = {}) {
  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuedAt()
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? AUDIENCE)
    .setExpirationTime(opts.expiresIn ?? "1h");
  return jwt.sign(privateKey);
}

const verifyOpts = () => ({ jwks, issuer: ISSUER, audience: AUDIENCE });

describe("verifyToken", () => {
  it("returns sub and roles for a valid token", async () => {
    const token = await sign({ sub: "auth0|abc", [ROLE_CLAIM]: ["agent"] });
    const claims = await verifyToken(token, verifyOpts());
    expect(claims.sub).toBe("auth0|abc");
    expect(claims.roles).toEqual(["agent"]);
  });

  it("returns empty roles array when role claim is missing", async () => {
    const token = await sign({ sub: "auth0|xyz" });
    const claims = await verifyToken(token, verifyOpts());
    expect(claims.sub).toBe("auth0|xyz");
    expect(claims.roles).toEqual([]);
  });

  it("returns multiple roles", async () => {
    const token = await sign({ sub: "auth0|m", [ROLE_CLAIM]: ["agent", "admin"] });
    const claims = await verifyToken(token, verifyOpts());
    expect(claims.roles).toEqual(["agent", "admin"]);
  });

  it("rejects an expired token", async () => {
    const token = await sign(
      { sub: "auth0|expired", [ROLE_CLAIM]: ["agent"] },
      { expiresIn: "-2m" }
    );
    await expect(verifyToken(token, verifyOpts())).rejects.toThrow(AuthError);
  });

  it("accepts a token within the 60s clock skew window", async () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = new SignJWT({ sub: "auth0|skew", [ROLE_CLAIM]: ["agent"] })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuedAt(now - 30)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime(now - 30); // just expired, but inside clock skew
    const token = await jwt.sign(privateKey);
    const claims = await verifyToken(token, verifyOpts());
    expect(claims.sub).toBe("auth0|skew");
  });

  it("rejects a token with the wrong issuer", async () => {
    const token = await sign(
      { sub: "auth0|wrong-iss" },
      { issuer: "https://attacker.example/" }
    );
    await expect(verifyToken(token, verifyOpts())).rejects.toThrow(AuthError);
  });

  it("rejects a token with the wrong audience", async () => {
    const token = await sign(
      { sub: "auth0|wrong-aud" },
      { audience: "https://api.other.local" }
    );
    await expect(verifyToken(token, verifyOpts())).rejects.toThrow(AuthError);
  });

  it("rejects a malformed token string", async () => {
    await expect(verifyToken("not.a.jwt", verifyOpts())).rejects.toThrow(AuthError);
  });
});

describe("verifyAuth0Jwt", () => {
  function makeReq(authHeader?: string): Request {
    const headers = new Headers();
    if (authHeader !== undefined) headers.set("authorization", authHeader);
    return new Request("http://localhost/api/test", { headers });
  }

  it("verifies token from the Authorization header", async () => {
    const token = await sign({ sub: "auth0|hdr", [ROLE_CLAIM]: ["agent"] });
    const claims = await verifyAuth0Jwt(makeReq(`Bearer ${token}`), verifyOpts());
    expect(claims.sub).toBe("auth0|hdr");
    expect(claims.roles).toEqual(["agent"]);
  });

  it("is case-insensitive for the Bearer prefix", async () => {
    const token = await sign({ sub: "auth0|case", [ROLE_CLAIM]: ["admin"] });
    const claims = await verifyAuth0Jwt(makeReq(`bearer ${token}`), verifyOpts());
    expect(claims.sub).toBe("auth0|case");
  });

  it("rejects a missing Authorization header", async () => {
    await expect(verifyAuth0Jwt(makeReq(), verifyOpts())).rejects.toThrow(AuthError);
  });

  it("rejects a header without the Bearer prefix", async () => {
    const token = await sign({ sub: "auth0|noprefix" });
    await expect(verifyAuth0Jwt(makeReq(token), verifyOpts())).rejects.toThrow(AuthError);
  });

  it("rejects a Bearer prefix with no token", async () => {
    await expect(verifyAuth0Jwt(makeReq("Bearer "), verifyOpts())).rejects.toThrow(AuthError);
  });

  it("throws AuthError with status 401 for unauthenticated requests", async () => {
    try {
      await verifyAuth0Jwt(makeReq(), verifyOpts());
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).status).toBe(401);
    }
  });
});
