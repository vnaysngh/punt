/**
 * BTC/USD price fetching — server-side only.
 *
 * Source priority (first success wins):
 *  1. Chainlink on-chain feed (Arbitrum) — cryptographically signed, manipulation-proof
 *  2. Binance REST
 *  3. Coinbase REST
 *  4. Kraken REST
 *  5. CoinGecko REST
 *
 * If ALL sources fail, throws — callers abort settlement rather than
 * risk settling with a wrong price.
 */

import { createPublicClient, http, parseAbi } from "viem";
import { arbitrum } from "viem/chains";

// ─── Chainlink ────────────────────────────────────────────────────────────────

// Chainlink BTC/USD aggregator on Arbitrum One.
// Source: https://docs.chain.link/data-feeds/price-feeds/addresses?network=arbitrum
// Updates every 0.5% deviation or 3600s heartbeat — effectively ~1s on Arbitrum.
const CHAINLINK_BTC_USD = "0x6ce185860a4963106506C203335A2910413708e9" as const;

// Minimal ABI — only need latestRoundData()
const AGGREGATOR_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

// How stale a Chainlink answer is allowed to be before we distrust it.
// Heartbeat on Arbitrum BTC/USD is 3600s — we allow 2× for safety.
const CHAINLINK_MAX_AGE_S = 7_200;

// RPC fallback chain — Chainlink reads are free, only need a working RPC.
// Configure ARBITRUM_RPC_URL in env (Alchemy/Infura recommended).
// Falls back to Arbitrum public RPC if not set.
function getRpcUrls(): string[] {
  const urls: string[] = [];
  if (process.env.ARBITRUM_RPC_URL) urls.push(process.env.ARBITRUM_RPC_URL);
  // Public Arbitrum RPC endpoints as fallback
  urls.push("https://arb1.arbitrum.io/rpc");
  urls.push("https://arbitrum-one.publicnode.com");
  return urls;
}

async function getChainlinkPrice(): Promise<number> {
  const rpcUrls = getRpcUrls();
  let lastErr: unknown;

  for (const rpcUrl of rpcUrls) {
    try {
      const client = createPublicClient({
        chain: arbitrum,
        transport: http(rpcUrl, { timeout: 5_000 }),
      });

      const [roundData, decimals] = await Promise.all([
        client.readContract({
          address: CHAINLINK_BTC_USD,
          abi: AGGREGATOR_ABI,
          functionName: "latestRoundData",
        }),
        client.readContract({
          address: CHAINLINK_BTC_USD,
          abi: AGGREGATOR_ABI,
          functionName: "decimals",
        }),
      ]);

      const [, answer, , updatedAt] = roundData;

      // Sanity checks before trusting the answer
      if (answer <= BigInt(0)) throw new Error("Chainlink: non-positive answer");

      const ageSeconds = Math.floor(Date.now() / 1000) - Number(updatedAt);
      if (ageSeconds > CHAINLINK_MAX_AGE_S) {
        throw new Error(`Chainlink: stale answer (${ageSeconds}s old, max ${CHAINLINK_MAX_AGE_S}s)`);
      }

      // answer has `decimals` decimal places (8 for BTC/USD)
      const price = Number(answer) / 10 ** decimals;
      return price;
    } catch (err) {
      lastErr = err;
      // Try next RPC
    }
  }

  throw lastErr ?? new Error("Chainlink: all RPC endpoints failed");
}

// ─── REST fallbacks ───────────────────────────────────────────────────────────

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

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getBtcPrice(): Promise<number> {
  // --- 1. Chainlink (Arbitrum on-chain, cryptographically verified) ---
  try {
    const price = await getChainlinkPrice();
    if (inBounds(price)) return price;
  } catch (err) {
    console.warn("[price] Chainlink failed, trying REST:", err instanceof Error ? err.message : err);
  }

  // --- 2. Binance ---
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

  // --- 3. Coinbase ---
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

  // --- 4. Kraken ---
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

  // --- 5. CoinGecko ---
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

  throw new Error("BTC price unavailable from all sources (Chainlink + 4 REST) — aborting to prevent incorrect settlement");
}
