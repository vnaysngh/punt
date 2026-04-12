// Fetches live BTC/USD price
// Primary: Binance (no key, fastest, most accurate)
// Fallback: CoinGecko (no key)

export async function getBtcPrice(): Promise<number> {
  // Try Binance first
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", {
      next: { revalidate: 0 }, // always fresh
    });
    if (res.ok) {
      const data = await res.json();
      const price = parseFloat(data.price);
      if (price > 0) return price;
    }
  } catch {
    // fall through to CoinGecko
  }

  // Fallback: CoinGecko
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    { next: { revalidate: 0 } }
  );
  if (!res.ok) throw new Error("Failed to fetch BTC price from all sources");
  const data = await res.json();
  return data.bitcoin.usd as number;
}
