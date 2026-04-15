import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 5_000;

function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { signal: controller.signal, cache: "no-store" }).finally(() =>
    clearTimeout(timer)
  );
}

type Candle = { time: number; open: number; high: number; low: number; close: number };

/**
 * GET /api/price/candles?startTime=<ms>&endTime=<ms>&limit=<n>
 *
 * Server-side proxy for kline/candle data. Falls back through multiple
 * exchanges because Binance blocks many cloud provider IPs.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const startTime = searchParams.get("startTime");
  const endTime   = searchParams.get("endTime");
  const limit     = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 100);

  if (!startTime || !endTime) {
    return NextResponse.json({ error: "startTime and endTime required" }, { status: 400 });
  }

  const startMs = Number(startTime);
  const endMs   = Number(endTime);
  if (isNaN(startMs) || isNaN(endMs)) {
    return NextResponse.json({ error: "Invalid timestamps" }, { status: 400 });
  }

  const MAX_RANGE_MS = 24 * 60 * 60 * 1000;
  if (endMs - startMs > MAX_RANGE_MS || endMs - startMs < 0) {
    return NextResponse.json({ error: "Time range must be between 0 and 24 hours" }, { status: 400 });
  }

  const now = Date.now();
  if (startMs > now + 3_600_000 || endMs > now + 3_600_000) {
    return NextResponse.json({ error: "Timestamps too far in the future" }, { status: 400 });
  }

  let candles: Candle[] | null = null;

  // --- 1. Binance ---
  if (!candles) {
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=${startMs}&endTime=${endMs}&limit=${limit}`;
      const res = await fetchWithTimeout(url);
      if (res.ok) {
        const data = (await res.json()) as unknown[][];
        candles = data.map((k) => ({
          time:  Math.floor(Number(k[0]) / 1000),
          open:  parseFloat(k[1] as string),
          high:  parseFloat(k[2] as string),
          low:   parseFloat(k[3] as string),
          close: parseFloat(k[4] as string),
        }));
      }
    } catch {
      // fall through
    }
  }

  // --- 2. Kraken OHLC (no API key, cloud-friendly) ---
  if (!candles) {
    try {
      // Kraken uses unix seconds for `since`, interval in minutes
      const sinceSeconds = Math.floor(startMs / 1000);
      const url = `https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1&since=${sinceSeconds}`;
      const res = await fetchWithTimeout(url);
      if (res.ok) {
        const data = await res.json();
        const rows = data?.result?.XXBTZUSD as unknown[][] | undefined;
        if (Array.isArray(rows)) {
          candles = rows
            .filter((r) => Number(r[0]) <= endMs / 1000)
            .slice(0, limit)
            .map((r) => ({
              time:  Number(r[0]),
              open:  parseFloat(r[1] as string),
              high:  parseFloat(r[2] as string),
              low:   parseFloat(r[3] as string),
              close: parseFloat(r[4] as string),
            }));
        }
      }
    } catch {
      // fall through
    }
  }

  // --- 3. CoinGecko market_chart/range (no key, 1-day granularity only for free) ---
  // CoinGecko free tier only gives minute-level data for ranges < 1 day
  if (!candles) {
    try {
      const fromSec = Math.floor(startMs / 1000);
      const toSec   = Math.floor(endMs / 1000);
      const url = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range?vs_currency=usd&from=${fromSec}&to=${toSec}`;
      const res = await fetchWithTimeout(url);
      if (res.ok) {
        const data = await res.json();
        const prices = data?.prices as [number, number][] | undefined;
        if (Array.isArray(prices) && prices.length > 0) {
          // CoinGecko returns [timestamp_ms, price] pairs — synthesize candles
          candles = prices.slice(0, limit).map(([ts, price]) => ({
            time:  Math.floor(ts / 1000),
            open:  price,
            high:  price,
            low:   price,
            close: price,
          }));
        }
      }
    } catch {
      // fall through
    }
  }

  if (!candles || candles.length === 0) {
    return NextResponse.json({ error: "Failed to fetch candles from all sources" }, { status: 502 });
  }

  return NextResponse.json(candles, {
    headers: { "Cache-Control": "public, max-age=10" },
  });
}
