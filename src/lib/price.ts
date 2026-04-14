// Fetches live BTC/USD price.
// Multiple sources with fallback chain — cloud provider IPs often get blocked
// by Binance/CoinGecko, so we need several options.
// All calls have a 5-second timeout — if ALL fail, throws so callers can
// decide whether to abort settlement (safer than using a stale cached price).

const TIMEOUT_MS = 5_000;

function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { signal: controller.signal, cache: "no-store" }).finally(() =>
    clearTimeout(timer)
  );
}

function inBounds(price: number): boolean {
  return price > 1_000 && price < 10_000_000;
}

export async function getBtcPrice(): Promise<number> {
  // --- 1. Binance ---
  try {
    const res = await fetchWithTimeout(
      "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"
    );
    if (res.ok) {
      const data = await res.json();
      const price = parseFloat(data.price);
      if (inBounds(price)) return price;
    }
  } catch {
    // fall through
  }

  // --- 2. Coinbase (no API key needed, cloud-friendly) ---
  try {
    const res = await fetchWithTimeout(
      "https://api.coinbase.com/v2/prices/BTC-USD/spot"
    );
    if (res.ok) {
      const data = await res.json();
      const price = parseFloat(data?.data?.amount);
      if (inBounds(price)) return price;
    }
  } catch {
    // fall through
  }

  // --- 3. Kraken (no API key needed) ---
  try {
    const res = await fetchWithTimeout(
      "https://api.kraken.com/0/public/Ticker?pair=XBTUSD"
    );
    if (res.ok) {
      const data = await res.json();
      const price = parseFloat(data?.result?.XXBTZUSD?.c?.[0]);
      if (inBounds(price)) return price;
    }
  } catch {
    // fall through
  }

  // --- 4. CoinGecko ---
  try {
    const res = await fetchWithTimeout(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
    );
    if (res.ok) {
      const data = await res.json();
      const price = data?.bitcoin?.usd as number | undefined;
      if (typeof price === "number" && inBounds(price)) return price;
    }
  } catch {
    // fall through
  }

  throw new Error("BTC price unavailable from all sources — aborting to prevent incorrect settlement");
}
