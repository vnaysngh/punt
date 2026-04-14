import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";

/**
 * GET/POST /api/cron/create-market
 *
 * Legacy entry point — redirects to the actual lifecycle engine at
 * /api/admin/cycle-markets. Kept for backwards compatibility with
 * any external callers, but the real logic lives in cycle-markets.
 *
 * Prefer calling /api/admin/cycle-markets directly.
 */

async function runCycle(baseUrl: string, cronSecret: string) {
  const res = await fetch(`${baseUrl}/api/admin/cycle-markets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cron-secret": cronSecret,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`/api/admin/cycle-markets returned ${res.status}: ${body}`);
  }
  return res.json();
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
    const result = await runCycle(baseUrl, process.env.CRON_SECRET ?? "");
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[cron/create-market]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
    const result = await runCycle(baseUrl, process.env.CRON_SECRET ?? "");
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[cron/create-market POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
