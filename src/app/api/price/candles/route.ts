import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/price/candles?startTime=<ms>&endTime=<ms>&limit=<n>
 *
 * Server-side proxy for Binance klines — avoids CSP issues with direct
 * browser → Binance connections and keeps API calls server-side.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const startTime = searchParams.get("startTime");
  const endTime   = searchParams.get("endTime");
  const limit     = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 100);

  if (!startTime || !endTime) {
    return NextResponse.json({ error: "startTime and endTime required" }, { status: 400 });
  }

  // Validate timestamps are numbers
  if (isNaN(Number(startTime)) || isNaN(Number(endTime))) {
    return NextResponse.json({ error: "Invalid timestamps" }, { status: 400 });
  }

  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=${startTime}&endTime=${endTime}&limit=${limit}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);

    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);

    if (!res.ok) {
      return NextResponse.json({ error: "Upstream error" }, { status: 502 });
    }

    const data = await res.json();

    // Transform to our candle format server-side
    const candles = (data as unknown[][]).map((k) => ({
      time:  Math.floor(Number(k[0]) / 1000),
      open:  parseFloat(k[1] as string),
      high:  parseFloat(k[2] as string),
      low:   parseFloat(k[3] as string),
      close: parseFloat(k[4] as string),
    }));

    return NextResponse.json(candles, {
      headers: {
        // Cache for 10s — candles update every minute anyway
        "Cache-Control": "public, max-age=10",
      },
    });
  } catch (err) {
    console.error("[candles]", err);
    return NextResponse.json({ error: "Failed to fetch candles" }, { status: 502 });
  }
}
