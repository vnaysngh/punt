import { NextResponse } from "next/server";
import { getBtcPrice } from "@/lib/price";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/price
//
// One-shot BTC price fetch. Used as:
//   1. WebSocket fallback by useBtcPrice hook when Binance WS is down
//   2. Settlement / cron can also call getBtcPrice() directly — this route
//      is not in the critical settlement path, just a convenience endpoint.
//
// Client-side price display uses the Binance WebSocket directly (useBtcPrice).
// ---------------------------------------------------------------------------

// Module-level cache: avoid hammering upstream if multiple fallback clients
// hit this simultaneously during a WS outage. Cache for up to 3 seconds.
let cached: { price: number; ts: number } | null = null;
const CACHE_TTL_MS = 3_000;

export async function GET() {
  const now = Date.now();
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(
      { price: cached.price, symbol: "BTC/USD", ts: cached.ts },
      { headers: { "Cache-Control": "public, max-age=3" } }
    );
  }

  try {
    const price = await getBtcPrice();
    cached = { price, ts: now };
    return NextResponse.json(
      { price, symbol: "BTC/USD", ts: now },
      { headers: { "Cache-Control": "public, max-age=3" } }
    );
  } catch {
    // Return stale value if available rather than a hard error
    if (cached) {
      return NextResponse.json(
        { price: cached.price, symbol: "BTC/USD", ts: cached.ts, stale: true },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json({ error: "Price unavailable" }, { status: 502 });
  }
}
