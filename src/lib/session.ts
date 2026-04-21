import { SignJWT, jwtVerify } from "jose";

// Lazy-load secret at RUNTIME, not module-load time.
// Next.js evaluates route modules during `next build` to collect page metadata.
// On Railway, NODE_ENV=production at build time but env vars (like SESSION_SECRET)
// are only injected at runtime. A top-level throw would crash every build.
let _secret: Uint8Array | null = null;

function getSecret(): Uint8Array {
  if (_secret) return _secret;
  const raw = process.env.SESSION_SECRET ?? "";
  if (process.env.NODE_ENV === "production") {
    if (!raw || raw.length < 32) {
      throw new Error(
        "[session] SESSION_SECRET must be set to at least 32 characters in production. " +
          "Generate with: openssl rand -hex 32"
      );
    }
  } else if (!raw) {
    console.warn(
      "[session] WARNING: SESSION_SECRET is not set. Using insecure dev fallback. " +
        "Set SESSION_SECRET in .env before testing auth flows."
    );
  }
  _secret = new TextEncoder().encode(
    raw || "dev-insecure-secret-do-not-use-in-production"
  );
  return _secret;
}

const ALG    = "HS256";
const EXPIRY = "7d";
// Refresh window: if the token has less than this time remaining, autoConnect silently
// re-issues it. No user interaction needed — the Loop SDK session is still valid.
export const REFRESH_BEFORE_EXPIRY_MS = 2 * 24 * 60 * 60 * 1000; // refresh when <2d left

export type SessionPayload = { partyId: string };

export async function signSession(partyId: string): Promise<string> {
  return new SignJWT({ partyId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, getSecret(), { algorithms: [ALG] });
  if (!payload.partyId || typeof payload.partyId !== "string") {
    throw new Error("Invalid session payload");
  }
  return { partyId: payload.partyId };
}

/**
 * Decode the expiry from a JWT without verifying the signature.
 * Safe for CLIENT-SIDE use only (to decide whether to refresh).
 * Never trust the payload for authorization — that happens server-side.
 */
export function getTokenExpiry(token: string): number | null {
  try {
    const [, payloadB64] = token.split(".");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null; // ms
  } catch {
    return null;
  }
}

export async function getSessionFromRequest(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const { partyId } = await verifySession(auth.slice(7));
    return partyId;
  } catch {
    return null;
  }
}
