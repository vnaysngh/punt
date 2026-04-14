import cron from "node-cron";

const BASE_URL    = process.env.APP_BASE_URL ?? "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET ?? "";

if (!CRON_SECRET) {
  console.warn("[cron] WARNING: CRON_SECRET is not set — API calls will be rejected");
}

async function callAdmin(path: string, method: "GET" | "POST" = "POST") {
  const url = `${BASE_URL}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": CRON_SECRET,
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[cron] ${path} → ${res.status}`, body);
    } else {
      console.log(`[cron] ${path} → ok`, body);
    }
  } catch (err) {
    console.error(`[cron] ${path} fetch error:`, err);
  }
}

/**
 * Market cycle: runs every 30 seconds via two cron expressions.
 * No startup tick — the scheduled job owns all market creation.
 * The atomic INSERT WHERE NOT EXISTS in /api/admin/cycle-markets ensures
 * that even if two ticks overlap, only one OPEN market is ever created.
 *
 * Running every 30s (vs 60s) means at most a 30s wait for the first market
 * after a fresh start, without needing a separate startup fire.
 */
function scheduleMarketCycle() {
  // node-cron doesn't support */30 * * * * * (6-field) in all versions,
  // so schedule two jobs at :00 and :30 of every minute.
  cron.schedule("* * * * *", async () => {
    console.log(`[cron] market cycle tick — ${new Date().toISOString()}`);
    await callAdmin("/api/admin/cycle-markets");
  });

  // Second tick at the 30-second mark using 6-field cron (seconds supported by node-cron v3+)
  cron.schedule("30 * * * * *", async () => {
    console.log(`[cron] market cycle tick (30s) — ${new Date().toISOString()}`);
    await callAdmin("/api/admin/cycle-markets");
  });

  console.log("[cron] Market cycle job scheduled (every 30s, no startup race)");
}

/**
 * Deposit sweeper: runs every 2 minutes.
 * Fallback for deposits not caught by the immediate 15s poll in /api/deposit.
 */
function scheduleDepositSweep() {
  cron.schedule("*/2 * * * *", async () => {
    console.log(`[cron] deposit sweep tick — ${new Date().toISOString()}`);
    await callAdmin("/api/cron/detect-deposits", "GET");
  });
  console.log("[cron] Deposit sweep job scheduled (every 2 min)");
}

export function startAllJobs() {
  scheduleMarketCycle();
  scheduleDepositSweep();
  console.log("[cron] All jobs started. First market cycle in ≤30s.");
}
