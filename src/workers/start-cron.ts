import "dotenv/config";
import { startAllJobs } from "../lib/cron";

console.log("[worker] Punt cron worker starting...");
console.log(`[worker] APP_BASE_URL = ${process.env.APP_BASE_URL ?? "http://localhost:3000"}`);
console.log(`[worker] CRON_SECRET = ${process.env.CRON_SECRET ? "***set***" : "NOT SET"}`);

startAllJobs();

// Keep process alive
process.on("SIGTERM", () => {
  console.log("[worker] SIGTERM received — shutting down");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[worker] SIGINT received — shutting down");
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  console.error("[worker] Uncaught exception:", err);
  // don't exit — keep the cron running
});

process.on("unhandledRejection", (reason) => {
  console.error("[worker] Unhandled rejection:", reason);
  // don't exit — keep the cron running
});
