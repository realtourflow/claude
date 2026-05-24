import {
  SignJWT,
  generateKeyPair,
  exportJWK,
  createLocalJWKSet,
  type JWK,
  type KeyObject,
} from "jose";
import type { VerifyOptions } from "@/lib/auth";

export const TEST_ISSUER = "https://test.auth0.local/";
export const TEST_AUDIENCE = "https://api.test.local";
export const ROLE_CLAIM = "https://realtourflow.com/roles";

let cached: { privateKey: KeyObject; publicJwk: JWK; opts: VerifyOptions } | undefined;

/**
 * Lazily generates an RS256 keypair (once per test run), then returns a token
 * signer and the VerifyOptions you can hand to verifyAuth0Jwt / verifyToken.
 */
export async function getTestSigner(): Promise<{
  signToken: (payload: Record<string, unknown>, opts?: SignOptions) => Promise<string>;
  verifyOpts: VerifyOptions;
}> {
  if (!cached) {
    const kp = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(kp.publicKey);
    publicJwk.kid = "test-key";
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
    const jwks = createLocalJWKSet({ keys: [publicJwk] });
    cached = {
      privateKey: kp.privateKey as KeyObject,
      publicJwk,
      opts: {
        jwks: jwks as unknown as VerifyOptions["jwks"],
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
      },
    };
  }
  const { privateKey, opts } = cached;

  async function signToken(
    payload: Record<string, unknown>,
    signOpts: SignOptions = {}
  ): Promise<string> {
    const jwt = new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuedAt()
      .setIssuer(signOpts.issuer ?? TEST_ISSUER)
      .setAudience(signOpts.audience ?? TEST_AUDIENCE)
      .setExpirationTime(signOpts.expiresIn ?? "1h");
    return jwt.sign(privateKey);
  }

  return { signToken, verifyOpts: opts };
}

export type SignOptions = {
  issuer?: string;
  audience?: string;
  expiresIn?: string;
};

/**
 * Convenience: returns an `Authorization: Bearer <token>` header value.
 */
export async function authHeader(
  sub: string,
  roles: string[] = ["agent"]
): Promise<string> {
  const { signToken } = await getTestSigner();
  const token = await signToken({ sub, [ROLE_CLAIM]: roles });
  return `Bearer ${token}`;
}
