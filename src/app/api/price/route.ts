import { NextResponse } from "next/server";
import { getBtcPrice } from "@/lib/price";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Background price poller
//
// Fetches BTC price every 2s on a server-side interval — completely independent
// of user requests. Users always get the last cached value instantly with no
// upstream latency. If a source is slow or down (e.g. Binance blocked on Railway,
// falling through to Coinbase/Kraken/CoinGecko with 5s timeouts each), the fetch
// happens quietly in the background and never blocks a response.
// ---------------------------------------------------------------------------
let cached: { price: number; ts: number } | null = null;
let polling = false;

function startPoller() {
  if (polling) return;
  polling = true;

  const tick = async () => {
    try {
      const price = await getBtcPrice();
      cached = { price, ts: Date.now() };
    } catch {
      // All sources failed — keep the last cached value, don't clear it.
      // Settlement uses its own getBtcPrice() call, not this cache.
    }
  };

  tick(); // fetch immediately on first request
  setInterval(tick, 2_000);
}

export async function GET() {
  startPoller(); // no-op after first call

  if (!cached) {
    // Cold start — poller just fired for the first time, wait for it
    try {
      const price = await getBtcPrice();
      cached = { price, ts: Date.now() };
    } catch {
      return NextResponse.json({ error: "Price unavailable" }, { status: 502 });
    }
  }

  return NextResponse.json(
    { price: cached.price, symbol: "BTC/USD", ts: cached.ts },
    { headers: { "Cache-Control": "public, max-age=2" } }
  );
}
