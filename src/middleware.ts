import { NextRequest, NextResponse } from "next/server";

/**
 * Next.js Edge Middleware
 *
 * Responsibilities:
 *   1. Rate limiting on sensitive API routes (in-memory sliding window)
 *   2. Block requests with no User-Agent (bots, raw curl scanners)
 *   3. Reject oversized request bodies before they hit route handlers
 *   4. Strip server version info
 *
 * NOTE: In production on Vercel, replace the in-memory rate limiter with
 * Upstash Redis (@upstash/ratelimit) — in-memory state doesn't persist
 * across serverless function invocations or multiple instances.
 */

// ---------------------------------------------------------------------------
// In-memory rate limiter (sliding window)
// Key: IP + route prefix → { count, windowStart }
// ---------------------------------------------------------------------------
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

// Clean stale entries every 5 minutes to prevent memory growth
let lastCleanup = Date.now();
function cleanupRateMap() {
  const now = Date.now();
  if (now - lastCleanup < 5 * 60 * 1000) return;
  lastCleanup = now;
  for (const [key, entry] of rateLimitMap) {
    if (now - entry.windowStart > 60_000) rateLimitMap.delete(key);
  }
}

interface RateRule {
  /** Route prefix to match (e.g. "/api/deposit") */
  prefix: string;
  /** Max requests per window */
  limit: number;
  /** Window size in ms */
  windowMs: number;
}

const RATE_RULES: RateRule[] = [
  // Auth: 10 session creations per minute per IP
  { prefix: "/api/auth/session",          limit: 10,  windowMs: 60_000 },
  // Deposits: 5 per minute per IP (one real deposit flow takes ~15s)
  { prefix: "/api/deposit",               limit: 5,   windowMs: 60_000 },
  // Withdrawals: 3 per minute per IP — on-chain calls are slow and expensive
  { prefix: "/api/withdraw",              limit: 3,   windowMs: 60_000 },
  // Price: 1s polling = 60 req/min per tab, allow 2 tabs + buffer
  { prefix: "/api/price",                 limit: 150, windowMs: 60_000 },
  // Bet placement: 10 per minute per IP — a legit user places 1 per round
  // More specific prefix must come before /api/markets to match first
  { prefix: "/api/markets/",              limit: 10,  windowMs: 60_000 },
  // Market list reads: 30 per minute (hydrator polls every 30s, generous for multi-tab)
  { prefix: "/api/markets",               limit: 30,  windowMs: 60_000 },
  // Users/bets read: 60 per minute (hydrator polls every 15-30s)
  { prefix: "/api/users",                 limit: 60,  windowMs: 60_000 },
  { prefix: "/api/bets",                  limit: 60,  windowMs: 60_000 },
  // Admin/cron routes: block entirely from browser — cron worker uses x-cron-secret
  // The secret check is the real auth, but rate limit adds an extra layer
  { prefix: "/api/admin",                 limit: 10,  windowMs: 60_000 },
  { prefix: "/api/cron",                  limit: 10,  windowMs: 60_000 },
];

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

function checkRateLimit(ip: string, rule: RateRule): boolean {
  const key = `${ip}|${rule.prefix}`;
  const now  = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now - entry.windowStart >= rule.windowMs) {
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return true; // allowed
  }

  entry.count++;
  if (entry.count > rule.limit) return false; // blocked
  return true;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
export function middleware(req: NextRequest) {
  cleanupRateMap();

  const { pathname } = req.nextUrl;

  // Only apply to API routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Block requests with missing or suspicious User-Agent (raw scanners, bots)
  const ua = req.headers.get("user-agent");
  if (!ua || ua.length < 5) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Reject oversized request bodies (> 64 KB) before they reach route handlers
  // Only applies to POST/PUT/PATCH — the Content-Length header is checked, not the body itself
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (["POST", "PUT", "PATCH"].includes(req.method) && contentLength > 65_536) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }

  const ip = getClientIp(req);

  // Rate limiting
  for (const rule of RATE_RULES) {
    if (pathname.startsWith(rule.prefix)) {
      if (!checkRateLimit(ip, rule)) {
        return NextResponse.json(
          { error: "Too many requests — slow down" },
          {
            status: 429,
            headers: {
              "Retry-After": "60",
              "X-RateLimit-Limit":  String(rule.limit),
              "X-RateLimit-Policy": `${rule.limit};w=${rule.windowMs / 1000}`,
            },
          }
        );
      }
      break; // first matching rule wins
    }
  }

  // Strip server version from responses
  const res = NextResponse.next();
  res.headers.delete("x-powered-by");
  res.headers.set("X-Content-Type-Options", "nosniff");

  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
