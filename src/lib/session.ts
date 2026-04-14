import { SignJWT, jwtVerify } from "jose";

const rawSecret = process.env.SESSION_SECRET ?? "";

// Hard-fail at module load in production if secret is absent or too weak.
// Prevents the server from ever issuing tokens signed with a default/empty key.
if (process.env.NODE_ENV === "production") {
  if (!rawSecret || rawSecret.length < 32) {
    throw new Error(
      "[session] SESSION_SECRET must be set to at least 32 characters in production. " +
        "Generate with: openssl rand -hex 32"
    );
  }
} else if (!rawSecret) {
  console.warn(
    "[session] WARNING: SESSION_SECRET is not set. Using insecure dev fallback. " +
      "Set SESSION_SECRET in .env before testing auth flows."
  );
}

const secret = new TextEncoder().encode(
  rawSecret || "dev-insecure-secret-do-not-use-in-production"
);

const ALG    = "HS256";
const EXPIRY = "24h"; // 7d was too long for a financial app — reduces attack window on stolen tokens

export type SessionPayload = { partyId: string };

export async function signSession(partyId: string): Promise<string> {
  return new SignJWT({ partyId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(secret);
}

export async function verifySession(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
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
