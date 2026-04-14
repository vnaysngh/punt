import crypto from "crypto";
import { NextRequest } from "next/server";

/**
 * Timing-safe verification of the cron secret.
 * Accepts either:
 *   x-cron-secret: <secret>          (local worker)
 *   Authorization: Bearer <secret>   (Vercel Cron)
 */
export function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;

  const header =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  if (!header) return false;

  // Always compare fixed-length HMAC digests — immune to length-extension
  // and leaks no timing information about the secret itself.
  const hmac = (s: string) =>
    crypto.createHmac("sha256", "punt-cron-verify").update(s).digest();

  return crypto.timingSafeEqual(hmac(secret), hmac(header));
}
