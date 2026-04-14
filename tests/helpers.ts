/**
 * Test helpers: JWT signing, request builders, DB cleanup.
 *
 * These call the real session signer and real Prisma client —
 * tests exercise the actual code paths, not mocks.
 */
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { addMinutes, subMinutes } from "date-fns";

// ─── JWT ────────────────────────────────────────────────────────────────────
const SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || "dev-insecure-secret-do-not-use-in-production"
);

export async function signJwt(partyId: string): Promise<string> {
  return new SignJWT({ partyId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(SECRET);
}

export async function signExpiredJwt(partyId: string): Promise<string> {
  return new SignJWT({ partyId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200) // 2h ago
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // expired 1h ago
    .sign(SECRET);
}

// ─── Request builders ───────────────────────────────────────────────────────
export function makeGet(path: string, opts?: { token?: string; cronSecret?: string }) {
  const url = `http://localhost:3000${path}`;
  const headers: Record<string, string> = {
    "User-Agent": "TestRunner/1.0",
  };
  if (opts?.token) headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts?.cronSecret) headers["x-cron-secret"] = opts.cronSecret;
  return new NextRequest(url, { method: "GET", headers });
}

export function makePost(
  path: string,
  body: unknown,
  opts?: { token?: string; cronSecret?: string }
) {
  const url = `http://localhost:3000${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "TestRunner/1.0",
  };
  if (opts?.token) headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts?.cronSecret) headers["x-cron-secret"] = opts.cronSecret;
  return new NextRequest(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// ─── DB helpers ─────────────────────────────────────────────────────────────
export const CRON_SECRET = process.env.CRON_SECRET || "punt-cron-secret-2024";

export async function cleanupTestData() {
  // Delete in dependency order
  await prisma.bet.deleteMany({ where: { user: { partyId: { startsWith: "test_" } } } });
  await prisma.deposit.deleteMany({ where: { user: { partyId: { startsWith: "test_" } } } });
  await prisma.withdrawal.deleteMany({ where: { user: { partyId: { startsWith: "test_" } } } });
  await prisma.user.deleteMany({ where: { partyId: { startsWith: "test_" } } });
  await prisma.bet.deleteMany({ where: { market: { id: { startsWith: "test_mkt_" } } } });
  await prisma.market.deleteMany({ where: { id: { startsWith: "test_mkt_" } } });
}

export async function createTestUser(partyId: string, balance: number = 1.0) {
  return prisma.user.create({
    data: { partyId, appBalance: balance },
  });
}

export async function createTestMarket(opts: {
  id: string;
  startPrice?: number;
  status?: "OPEN" | "CLOSED" | "SETTLED";
  minutesFromNow?: number;       // closeAt = now + N minutes (positive = future, negative = past)
  openMinutesAgo?: number;       // openAt = now - N minutes
}) {
  const now = new Date();
  return prisma.market.create({
    data: {
      id: opts.id,
      question: "Test: What will BTC/USD be?",
      assetPair: "BTC/USD",
      category: "crypto",
      startPrice: opts.startPrice ?? 100000,
      status: opts.status ?? "OPEN",
      openAt: subMinutes(now, opts.openMinutesAgo ?? 5),
      closeAt: addMinutes(now, opts.minutesFromNow ?? 10),
      totalUp: 0,
      totalDown: 0,
    },
  });
}

export async function getUser(partyId: string) {
  return prisma.user.findUnique({ where: { partyId } });
}

export async function getUserBalance(partyId: string): Promise<number> {
  const u = await prisma.user.findUnique({ where: { partyId } });
  return u?.appBalance.toNumber() ?? 0;
}

/** Parse JSON from a NextResponse */
export async function json(res: Response): Promise<any> {
  return res.json();
}
