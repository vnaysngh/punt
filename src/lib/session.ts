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
const EXPIRY = "30d"; // 30 days — withdrawals require Loop wallet signature so stolen token risk is low

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
