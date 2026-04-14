// Fetches live BTC/USD price.
// Primary:  Binance (no key, lowest latency)
// Fallback: CoinGecko (no key)
// Both calls have a 5-second timeout — if both fail, throws so callers can
// decide whether to abort settlement (safer than using a stale cached price).

const TIMEOUT_MS = 5_000;

function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { signal: controller.signal, cache: "no-store" }).finally(() =>
    clearTimeout(timer)
  );
}

export async function getBtcPrice(): Promise<number> {
  // --- Binance ---
  try {
    const res = await fetchWithTimeout(
      "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"
    );
    if (res.ok) {
      const data = await res.json();
      const price = parseFloat(data.price);
      if (price > 1_000 && price < 10_000_000) return price; // sanity bounds
    }
  } catch {
    // timeout or network error — fall through to CoinGecko
  }

  // --- CoinGecko fallback ---
  try {
    const res = await fetchWithTimeout(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
    );
    if (res.ok) {
      const data = await res.json();
      const price = data?.bitcoin?.usd as number | undefined;
      if (typeof price === "number" && price > 1_000 && price < 10_000_000) return price;
    }
  } catch {
    // fall through to error
  }

  throw new Error("BTC price unavailable from all sources — aborting to prevent incorrect settlement");
}
