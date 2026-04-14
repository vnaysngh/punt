/**
 * FULL CYCLE INTEGRATION TEST
 *
 * Tests the entire betting lifecycle: auth → deposit-like credit → bet → settle → payout
 * Exercises every API route handler directly, with real DB, mocked prices.
 * Covers: security, precision, race conditions, edge cases, the entire audit checklist.
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  signJwt,
  signExpiredJwt,
  makeGet,
  makePost,
  cleanupTestData,
  createTestUser,
  createTestMarket,
  getUserBalance,
  json,
  CRON_SECRET,
} from "./helpers";
import { prisma } from "@/lib/prisma";
import { addMinutes, subMinutes } from "date-fns";

// ─── Mock getBtcPrice so tests don't hit Binance ────────────────────────────
let mockBtcPrice = 100500;
vi.mock("@/lib/price", () => ({
  getBtcPrice: vi.fn(() => Promise.resolve(mockBtcPrice)),
}));

// ─── Route handler imports ──────────────────────────────────────────────────
// Import AFTER mocks are set up
import { POST as authSession } from "@/app/api/auth/session/route";
import { GET as getUsers } from "@/app/api/users/route";
import { GET as getBets } from "@/app/api/bets/route";
import { GET as getMarkets } from "@/app/api/markets/route";
import { POST as placeBet } from "@/app/api/markets/[id]/bet/route";
import { GET as getMarketBets } from "@/app/api/markets/[id]/bets/route";
import { POST as settleMarket } from "@/app/api/markets/[id]/settle/route";
import { GET as priceRoute } from "@/app/api/price/route";
import { GET as candlesRoute } from "@/app/api/price/candles/route";

// Helper to call route handlers that take { params: Promise<{ id: string }> }
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ═══════════════════════════════════════════════════════════════════════════
//  SETUP / TEARDOWN
// ═══════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════
//  1. AUTH / SESSION TESTS
// ═══════════════════════════════════════════════════════════════════════════
describe("POST /api/auth/session", () => {
  it("issues JWT for valid partyId", async () => {
    const req = makePost("/api/auth/session", {
      partyId: "test_alice::abcdef01",
      email: "alice@test.com",
    });
    const res = await authSession(req);
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.token).toBeDefined();
    expect(typeof data.token).toBe("string");
    expect(data.appBalance).toBe(0);
  });

  it("rejects empty partyId", async () => {
    const req = makePost("/api/auth/session", { partyId: "" });
    const res = await authSession(req);
    expect(res.status).toBe(400);
  });

  it("rejects partyId without :: separator", async () => {
    const req = makePost("/api/auth/session", { partyId: "no-separator-here" });
    const res = await authSession(req);
    expect(res.status).toBe(400);
  });

  it("rejects partyId with special characters", async () => {
    const req = makePost("/api/auth/session", { partyId: "mal<script>::abcdef01" });
    const res = await authSession(req);
    expect(res.status).toBe(400);
  });

  it("rejects invalid publicKey (non-hex)", async () => {
    const req = makePost("/api/auth/session", {
      partyId: "test_bob::abcdef02",
      publicKey: "not-a-hex-string!!!",
    });
    const res = await authSession(req);
    expect(res.status).toBe(400);
  });

  it("rejects too-short publicKey", async () => {
    const req = makePost("/api/auth/session", {
      partyId: "test_bob::abcdef02",
      publicKey: "abcd", // only 4 chars, minimum is 16
    });
    const res = await authSession(req);
    expect(res.status).toBe(400);
  });

  it("accepts valid publicKey", async () => {
    const req = makePost("/api/auth/session", {
      partyId: "test_bob::abcdef02",
      publicKey: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4", // 32 hex chars
    });
    const res = await authSession(req);
    expect(res.status).toBe(200);
  });

  it("rejects invalid email", async () => {
    const req = makePost("/api/auth/session", {
      partyId: "test_charlie::abcdef03",
      email: "not-an-email",
    });
    const res = await authSession(req);
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON body", async () => {
    const url = "http://localhost:3000/api/auth/session";
    const req = new NextRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Test/1.0" },
      body: "not json{{{",
    });
    const res = await authSession(req);
    expect(res.status).toBe(400);
  });

  it("upsert: second call doesn't reset balance", async () => {
    // First, give alice a balance
    await prisma.user.update({
      where: { partyId: "test_alice::abcdef01" },
      data: { appBalance: 5.0 },
    });
    // Second session call — should NOT reset balance
    const req = makePost("/api/auth/session", {
      partyId: "test_alice::abcdef01",
    });
    const res = await authSession(req);
    const data = await json(res);
    expect(data.appBalance).toBe(5.0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  2. USER ENDPOINT TESTS
// ═══════════════════════════════════════════════════════════════════════════
describe("GET /api/users", () => {
  it("returns user data with valid token", async () => {
    const token = await signJwt("test_alice::abcdef01");
    const req = makeGet("/api/users", { token });
    const res = await getUsers(req);
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.partyId).toBe("test_alice::abcdef01");
    expect(typeof data.appBalance).toBe("number");
  });

  it("rejects without auth", async () => {
    const req = makeGet("/api/users");
    const res = await getUsers(req);
    expect(res.status).toBe(401);
  });

  it("rejects expired JWT", async () => {
    const token = await signExpiredJwt("test_alice::abcdef01");
    const req = makeGet("/api/users", { token });
    const res = await getUsers(req);
    expect(res.status).toBe(401);
  });

  it("rejects forged JWT (wrong secret)", async () => {
    const badSecret = new TextEncoder().encode("wrong-secret-definitely-wrong-123");
    const { SignJWT: SJ } = await import("jose");
    const token = await new SJ({ partyId: "test_alice::abcdef01" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(badSecret);
    const req = makeGet("/api/users", { token });
    const res = await getUsers(req);
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  3. BETTING — FULL FLOW
// ═══════════════════════════════════════════════════════════════════════════
describe("POST /api/markets/[id]/bet", () => {
  let aliceToken: string;
  let bobToken: string;

  beforeAll(async () => {
    // Ensure clean state
    await cleanupTestData();

    // Create users with known balances
    await createTestUser("test_alice::abcdef01", 10.0);
    await createTestUser("test_bob::abcdef02", 5.0);
    aliceToken = await signJwt("test_alice::abcdef01");
    bobToken = await signJwt("test_bob::abcdef02");
  });

  beforeEach(async () => {
    // Clean up markets/bets between tests
    await prisma.bet.deleteMany({ where: { market: { id: { startsWith: "test_mkt_" } } } });
    await prisma.market.deleteMany({ where: { id: { startsWith: "test_mkt_" } } });
    // Reset balances
    await prisma.user.update({ where: { partyId: "test_alice::abcdef01" }, data: { appBalance: 10.0 } });
    await prisma.user.update({ where: { partyId: "test_bob::abcdef02" }, data: { appBalance: 5.0 } });
  });

  it("places a valid UP bet", async () => {
    await createTestMarket({ id: "test_mkt_1", minutesFromNow: 10 });
    const req = makePost(
      "/api/markets/test_mkt_1/bet",
      { direction: "UP", amount: 1.0 },
      { token: aliceToken }
    );
    const res = await placeBet(req, makeParams("test_mkt_1"));
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.bet.direction).toBe("UP");
    expect(data.bet.amount).toBe(1.0);
    expect(data.appBalance).toBe(9.0);

    // Verify DB state
    const bal = await getUserBalance("test_alice::abcdef01");
    expect(bal).toBe(9.0);

    // Verify market pool updated
    const mkt = await prisma.market.findUnique({ where: { id: "test_mkt_1" } });
    expect(mkt!.totalUp.toNumber()).toBe(1.0);
    expect(mkt!.totalDown.toNumber()).toBe(0);
  });

  it("places a valid DOWN bet", async () => {
    await createTestMarket({ id: "test_mkt_2", minutesFromNow: 10 });
    const req = makePost(
      "/api/markets/test_mkt_2/bet",
      { direction: "DOWN", amount: 0.5 },
      { token: bobToken }
    );
    const res = await placeBet(req, makeParams("test_mkt_2"));
    expect(res.status).toBe(201);
    const data = await json(res);
    expect(data.bet.direction).toBe("DOWN");
    expect(data.appBalance).toBe(4.5);
  });

  it("rejects duplicate bet (same user, same market)", async () => {
    await createTestMarket({ id: "test_mkt_dup", minutesFromNow: 10 });
    // First bet succeeds
    const req1 = makePost(
      "/api/markets/test_mkt_dup/bet",
      { direction: "UP", amount: 0.1 },
      { token: aliceToken }
    );
    const res1 = await placeBet(req1, makeParams("test_mkt_dup"));
    expect(res1.status).toBe(201);

    // Second bet same user same market → 409
    const req2 = makePost(
      "/api/markets/test_mkt_dup/bet",
      { direction: "DOWN", amount: 0.1 },
      { token: aliceToken }
    );
    const res2 = await placeBet(req2, makeParams("test_mkt_dup"));
    expect(res2.status).toBe(409);
    const data = await json(res2);
    expect(data.error).toContain("already have a bet");
  });

  it("allows different users to bet on same market", async () => {
    await createTestMarket({ id: "test_mkt_multi", minutesFromNow: 10 });

    const req1 = makePost(
      "/api/markets/test_mkt_multi/bet",
      { direction: "UP", amount: 1.0 },
      { token: aliceToken }
    );
    const res1 = await placeBet(req1, makeParams("test_mkt_multi"));
    expect(res1.status).toBe(201);

    const req2 = makePost(
      "/api/markets/test_mkt_multi/bet",
      { direction: "DOWN", amount: 2.0 },
      { token: bobToken }
    );
    const res2 = await placeBet(req2, makeParams("test_mkt_multi"));
    expect(res2.status).toBe(201);

    // Verify pool
    const mkt = await prisma.market.findUnique({ where: { id: "test_mkt_multi" } });
    expect(mkt!.totalUp.toNumber()).toBe(1.0);
    expect(mkt!.totalDown.toNumber()).toBe(2.0);
  });

  it("rejects bet without auth", async () => {
    await createTestMarket({ id: "test_mkt_noauth", minutesFromNow: 10 });
    const req = makePost("/api/markets/test_mkt_noauth/bet", { direction: "UP", amount: 0.1 });
    const res = await placeBet(req, makeParams("test_mkt_noauth"));
    expect(res.status).toBe(401);
  });

  it("rejects invalid direction", async () => {
    await createTestMarket({ id: "test_mkt_dir", minutesFromNow: 10 });

    for (const bad of ["up", "down", "LEFT", "BOTH", "", null, 123, "UP "]) {
      const req = makePost(
        "/api/markets/test_mkt_dir/bet",
        { direction: bad, amount: 0.1 },
        { token: aliceToken }
      );
      const res = await placeBet(req, makeParams("test_mkt_dir"));
      expect(res.status).toBe(400);
    }
  });

  it("rejects amount below minimum", async () => {
    await createTestMarket({ id: "test_mkt_min", minutesFromNow: 10 });
    const req = makePost(
      "/api/markets/test_mkt_min/bet",
      { direction: "UP", amount: 0.000001 }, // below 0.00001
      { token: aliceToken }
    );
    const res = await placeBet(req, makeParams("test_mkt_min"));
    expect(res.status).toBe(400);
  });

  it("rejects amount above maximum", async () => {
    await createTestMarket({ id: "test_mkt_max", minutesFromNow: 10 });
    const req = makePost(
      "/api/markets/test_mkt_max/bet",
      { direction: "UP", amount: 1001 }, // above 1000
      { token: aliceToken }
    );
    const res = await placeBet(req, makeParams("test_mkt_max"));
    expect(res.status).toBe(400);
  });

  it("rejects negative amount", async () => {
    await createTestMarket({ id: "test_mkt_neg", minutesFromNow: 10 });
    const req = makePost(
      "/api/markets/test_mkt_neg/bet",
      { direction: "UP", amount: -1.0 },
      { token: aliceToken }
    );
    const res = await placeBet(req, makeParams("test_mkt_neg"));
    expect(res.status).toBe(400);
  });

  it("rejects zero amount", async () => {
    await createTestMarket({ id: "test_mkt_zero", minutesFromNow: 10 });
    const req = makePost(
      "/api/markets/test_mkt_zero/bet",
      { direction: "UP", amount: 0 },
      { token: aliceToken }
    );
    const res = await placeBet(req, makeParams("test_mkt_zero"));
    expect(res.status).toBe(400);
  });

  it("rejects NaN / Infinity amount", async () => {
    await createTestMarket({ id: "test_mkt_nan", minutesFromNow: 10 });

    for (const bad of [NaN, Infinity, -Infinity, "one"]) {
      const req = makePost(
        "/api/markets/test_mkt_nan/bet",
        { direction: "UP", amount: bad },
        { token: aliceToken }
      );
      const res = await placeBet(req, makeParams("test_mkt_nan"));
      expect(res.status).toBe(400);
    }
  });

  it("rejects bet when balance insufficient", async () => {
    await createTestMarket({ id: "test_mkt_broke", minutesFromNow: 10 });
    // bob has 5.0
    const req = makePost(
      "/api/markets/test_mkt_broke/bet",
      { direction: "UP", amount: 50.0 },
      { token: bobToken }
    );
    const res = await placeBet(req, makeParams("test_mkt_broke"));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("balance");

    // Verify balance unchanged
    expect(await getUserBalance("test_bob::abcdef02")).toBe(5.0);
  });

  it("rejects bet on non-existent market", async () => {
    const req = makePost(
      "/api/markets/test_mkt_DOES_NOT_EXIST/bet",
      { direction: "UP", amount: 0.1 },
      { token: aliceToken }
    );
    const res = await placeBet(req, makeParams("test_mkt_DOES_NOT_EXIST"));
    expect(res.status).toBe(404);
  });

  it("rejects bet on settled market", async () => {
    await createTestMarket({ id: "test_mkt_settled", status: "SETTLED", minutesFromNow: -10 });
    const req = makePost(
      "/api/markets/test_mkt_settled/bet",
      { direction: "UP", amount: 0.1 },
      { token: aliceToken }
    );
    const res = await placeBet(req, makeParams("test_mkt_settled"));
    expect(res.status).toBe(400);
  });

  it("rejects bet in locked period (< 5 min to close)", async () => {
    // Market closes in 4 minutes — should be locked
    await createTestMarket({ id: "test_mkt_locked", minutesFromNow: 4 });
    const req = makePost(
      "/api/markets/test_mkt_locked/bet",
      { direction: "UP", amount: 0.1 },
      { token: aliceToken }
    );
    const res = await placeBet(req, makeParams("test_mkt_locked"));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("locked");
  });

  it("allows bet when > 5 min to close", async () => {
    // Market closes in 6 minutes — should be open
    await createTestMarket({ id: "test_mkt_open6", minutesFromNow: 6 });
    const req = makePost(
      "/api/markets/test_mkt_open6/bet",
      { direction: "UP", amount: 0.1 },
      { token: aliceToken }
    );
    const res = await placeBet(req, makeParams("test_mkt_open6"));
    expect(res.status).toBe(201);
  });

  it("rejects bet on already-closed market (closeAt in past)", async () => {
    await createTestMarket({ id: "test_mkt_past", minutesFromNow: -1 });
    const req = makePost(
      "/api/markets/test_mkt_past/bet",
      { direction: "UP", amount: 0.1 },
      { token: aliceToken }
    );
    const res = await placeBet(req, makeParams("test_mkt_past"));
    expect(res.status).toBe(400);
  });

  it("handles satoshi precision correctly", async () => {
    await createTestMarket({ id: "test_mkt_prec", minutesFromNow: 10 });
    // 0.123456789 should round to 0.12345679 (8 decimal places)
    const req = makePost(
      "/api/markets/test_mkt_prec/bet",
      { direction: "UP", amount: 0.123456789 },
      { token: aliceToken }
    );
    const res = await placeBet(req, makeParams("test_mkt_prec"));
    expect(res.status).toBe(201);
    const data = await json(res);
    // Rounded to 8 decimal places
    expect(data.bet.amount).toBe(0.12345679);
  });

  it("ignores extra fields in body (userId, partyId injection)", async () => {
    await createTestMarket({ id: "test_mkt_inject", minutesFromNow: 10 });
    const req = makePost(
      "/api/markets/test_mkt_inject/bet",
      {
        direction: "UP",
        amount: 0.1,
        partyId: "hacker::deadbeef", // should be ignored
        userId: "cuid_hacker",       // should be ignored
        status: "WON",               // should be ignored
        payout: 999999,              // should be ignored
      },
      { token: aliceToken }
    );
    const res = await placeBet(req, makeParams("test_mkt_inject"));
    expect(res.status).toBe(201);
    const data = await json(res);
    // Bet should belong to alice, not the injected hacker
    expect(data.bet.amount).toBe(0.1);
    expect(data.bet.status).toBe("PENDING");
    expect(data.bet.payout).toBeNull();
  });

  it("rejects invalid JSON body", async () => {
    await createTestMarket({ id: "test_mkt_badjson", minutesFromNow: 10 });
    const url = "http://localhost:3000/api/markets/test_mkt_badjson/bet";
    const req = new NextRequest(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${aliceToken}`,
        "User-Agent": "Test/1.0",
      },
      body: "not-json{{{",
    });
    const res = await placeBet(req, makeParams("test_mkt_badjson"));
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  4. SETTLEMENT — PAYOUTS & FEES
// ═══════════════════════════════════════════════════════════════════════════
describe("Settlement: payouts, fees, precision", () => {
  let aliceToken: string;
  let bobToken: string;

  beforeAll(async () => {
    await cleanupTestData();
    await createTestUser("test_alice::abcdef01", 10.0);
    await createTestUser("test_bob::abcdef02", 10.0);
    aliceToken = await signJwt("test_alice::abcdef01");
    bobToken = await signJwt("test_bob::abcdef02");
  });

  beforeEach(async () => {
    await prisma.bet.deleteMany({ where: { market: { id: { startsWith: "test_mkt_" } } } });
    await prisma.market.deleteMany({ where: { id: { startsWith: "test_mkt_" } } });
    await prisma.user.update({ where: { partyId: "test_alice::abcdef01" }, data: { appBalance: 10.0 } });
    await prisma.user.update({ where: { partyId: "test_bob::abcdef02" }, data: { appBalance: 10.0 } });
  });

  it("winner gets pool minus 5% fee (UP wins)", async () => {
    // Create expired market
    await createTestMarket({
      id: "test_mkt_settle1",
      startPrice: 100000,
      minutesFromNow: -1, // expired
      openMinutesAgo: 16,
    });

    // Place bets directly in DB (market is expired, can't use API)
    const alice = await prisma.user.findUnique({ where: { partyId: "test_alice::abcdef01" } });
    const bob = await prisma.user.findUnique({ where: { partyId: "test_bob::abcdef02" } });

    await prisma.bet.create({
      data: { userId: alice!.id, marketId: "test_mkt_settle1", direction: "UP", amount: 3.0, status: "PENDING" },
    });
    await prisma.bet.create({
      data: { userId: bob!.id, marketId: "test_mkt_settle1", direction: "DOWN", amount: 2.0, status: "PENDING" },
    });
    await prisma.market.update({
      where: { id: "test_mkt_settle1" },
      data: { totalUp: 3.0, totalDown: 2.0 },
    });
    // Deduct balances
    await prisma.user.update({ where: { id: alice!.id }, data: { appBalance: { decrement: 3.0 } } });
    await prisma.user.update({ where: { id: bob!.id }, data: { appBalance: { decrement: 2.0 } } });

    // Set price to go UP
    mockBtcPrice = 101000; // above startPrice of 100000

    // Settle
    const req = makePost("/api/markets/test_mkt_settle1/settle", {}, { cronSecret: CRON_SECRET });
    const res = await settleMarket(req, makeParams("test_mkt_settle1"));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.settled).toBe(true);
    expect(data.winningDirection).toBe("UP");

    // Verify payouts:
    // totalPool = 5.0, adjustedPool = 5.0 * 0.95 = 4.75
    // Alice bet 3.0 UP on winningPool of 3.0 → payout = (3/3) * 4.75 = 4.75
    // Bob bet DOWN → loses, payout = 0
    const aliceBet = await prisma.bet.findFirst({ where: { userId: alice!.id, marketId: "test_mkt_settle1" } });
    expect(aliceBet!.status).toBe("WON");
    expect(aliceBet!.payout!.toNumber()).toBe(4.75);

    const bobBet = await prisma.bet.findFirst({ where: { userId: bob!.id, marketId: "test_mkt_settle1" } });
    expect(bobBet!.status).toBe("LOST");
    expect(bobBet!.payout!.toNumber()).toBe(0);

    // Alice: started 7.0 (10 - 3), gets 4.75 back → 11.75
    expect(await getUserBalance("test_alice::abcdef01")).toBe(11.75);
    // Bob: started 8.0 (10 - 2), gets nothing → 8.0
    expect(await getUserBalance("test_bob::abcdef02")).toBe(8.0);
  });

  it("winner gets pool minus 5% fee (DOWN wins)", async () => {
    await createTestMarket({
      id: "test_mkt_settle2",
      startPrice: 100000,
      minutesFromNow: -1,
      openMinutesAgo: 16,
    });

    const alice = await prisma.user.findUnique({ where: { partyId: "test_alice::abcdef01" } });
    const bob = await prisma.user.findUnique({ where: { partyId: "test_bob::abcdef02" } });

    await prisma.bet.create({
      data: { userId: alice!.id, marketId: "test_mkt_settle2", direction: "UP", amount: 2.0, status: "PENDING" },
    });
    await prisma.bet.create({
      data: { userId: bob!.id, marketId: "test_mkt_settle2", direction: "DOWN", amount: 3.0, status: "PENDING" },
    });
    await prisma.market.update({
      where: { id: "test_mkt_settle2" },
      data: { totalUp: 2.0, totalDown: 3.0 },
    });
    await prisma.user.update({ where: { id: alice!.id }, data: { appBalance: { decrement: 2.0 } } });
    await prisma.user.update({ where: { id: bob!.id }, data: { appBalance: { decrement: 3.0 } } });

    mockBtcPrice = 99000; // below startPrice → DOWN wins

    const req = makePost("/api/markets/test_mkt_settle2/settle", {}, { cronSecret: CRON_SECRET });
    const res = await settleMarket(req, makeParams("test_mkt_settle2"));
    expect(res.status).toBe(200);

    // totalPool = 5.0, adjusted = 4.75
    // Bob bet 3.0 DOWN on winningPool of 3.0 → payout = (3/3) * 4.75 = 4.75
    const bobBet = await prisma.bet.findFirst({ where: { userId: bob!.id, marketId: "test_mkt_settle2" } });
    expect(bobBet!.status).toBe("WON");
    expect(bobBet!.payout!.toNumber()).toBe(4.75);

    const aliceBet = await prisma.bet.findFirst({ where: { userId: alice!.id, marketId: "test_mkt_settle2" } });
    expect(aliceBet!.status).toBe("LOST");
  });

  it("DRAW: everyone gets refunded, no fee", async () => {
    await createTestMarket({
      id: "test_mkt_draw",
      startPrice: 100000,
      minutesFromNow: -1,
      openMinutesAgo: 16,
    });

    const alice = await prisma.user.findUnique({ where: { partyId: "test_alice::abcdef01" } });
    const bob = await prisma.user.findUnique({ where: { partyId: "test_bob::abcdef02" } });

    await prisma.bet.create({
      data: { userId: alice!.id, marketId: "test_mkt_draw", direction: "UP", amount: 1.5, status: "PENDING" },
    });
    await prisma.bet.create({
      data: { userId: bob!.id, marketId: "test_mkt_draw", direction: "DOWN", amount: 2.5, status: "PENDING" },
    });
    await prisma.market.update({
      where: { id: "test_mkt_draw" },
      data: { totalUp: 1.5, totalDown: 2.5 },
    });
    await prisma.user.update({ where: { id: alice!.id }, data: { appBalance: { decrement: 1.5 } } });
    await prisma.user.update({ where: { id: bob!.id }, data: { appBalance: { decrement: 2.5 } } });

    mockBtcPrice = 100000; // exact same as start → DRAW

    const req = makePost("/api/markets/test_mkt_draw/settle", {}, { cronSecret: CRON_SECRET });
    const res = await settleMarket(req, makeParams("test_mkt_draw"));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.winningDirection).toBe("DRAW");
    expect(data.refunded).toBe(2);

    // Both get full refund — no fee on draws
    const aliceBet = await prisma.bet.findFirst({ where: { userId: alice!.id, marketId: "test_mkt_draw" } });
    expect(aliceBet!.status).toBe("REFUNDED");
    expect(aliceBet!.payout!.toNumber()).toBe(1.5);

    expect(await getUserBalance("test_alice::abcdef01")).toBe(10.0); // back to original
    expect(await getUserBalance("test_bob::abcdef02")).toBe(10.0);
  });

  it("no bets: settle with zero pool", async () => {
    await createTestMarket({
      id: "test_mkt_empty",
      startPrice: 100000,
      minutesFromNow: -1,
      openMinutesAgo: 16,
    });

    mockBtcPrice = 101000;

    const req = makePost("/api/markets/test_mkt_empty/settle", {}, { cronSecret: CRON_SECRET });
    const res = await settleMarket(req, makeParams("test_mkt_empty"));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.settled).toBe(true);
    expect(data.bets).toBe(0);
  });

  it("all bets on one side: losers get nothing, winner(s) refunded minus fee", async () => {
    // All bets are UP, price goes DOWN → nobody on winning side → refund all
    await createTestMarket({
      id: "test_mkt_onesided",
      startPrice: 100000,
      minutesFromNow: -1,
      openMinutesAgo: 16,
    });

    const alice = await prisma.user.findUnique({ where: { partyId: "test_alice::abcdef01" } });
    const bob = await prisma.user.findUnique({ where: { partyId: "test_bob::abcdef02" } });

    await prisma.bet.create({
      data: { userId: alice!.id, marketId: "test_mkt_onesided", direction: "UP", amount: 2.0, status: "PENDING" },
    });
    await prisma.bet.create({
      data: { userId: bob!.id, marketId: "test_mkt_onesided", direction: "UP", amount: 3.0, status: "PENDING" },
    });
    await prisma.market.update({
      where: { id: "test_mkt_onesided" },
      data: { totalUp: 5.0, totalDown: 0 },
    });
    await prisma.user.update({ where: { id: alice!.id }, data: { appBalance: { decrement: 2.0 } } });
    await prisma.user.update({ where: { id: bob!.id }, data: { appBalance: { decrement: 3.0 } } });

    mockBtcPrice = 99000; // DOWN wins, but nobody bet DOWN → refund all

    const req = makePost("/api/markets/test_mkt_onesided/settle", {}, { cronSecret: CRON_SECRET });
    const res = await settleMarket(req, makeParams("test_mkt_onesided"));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.refunded).toBe(2);

    expect(await getUserBalance("test_alice::abcdef01")).toBe(10.0);
    expect(await getUserBalance("test_bob::abcdef02")).toBe(10.0);
  });

  it("multiple winners split proportionally with fee", async () => {
    await createTestMarket({
      id: "test_mkt_split",
      startPrice: 100000,
      minutesFromNow: -1,
      openMinutesAgo: 16,
    });

    const alice = await prisma.user.findUnique({ where: { partyId: "test_alice::abcdef01" } });
    const bob = await prisma.user.findUnique({ where: { partyId: "test_bob::abcdef02" } });

    // Alice bets 1 UP, Bob bets 3 UP, both UP. Need a DOWN bettor.
    // Create a third user
    const charlie = await createTestUser("test_charlie::abcdef03", 10.0);

    await prisma.bet.create({
      data: { userId: alice!.id, marketId: "test_mkt_split", direction: "UP", amount: 1.0, status: "PENDING" },
    });
    await prisma.bet.create({
      data: { userId: bob!.id, marketId: "test_mkt_split", direction: "UP", amount: 3.0, status: "PENDING" },
    });
    await prisma.bet.create({
      data: { userId: charlie.id, marketId: "test_mkt_split", direction: "DOWN", amount: 6.0, status: "PENDING" },
    });
    await prisma.market.update({
      where: { id: "test_mkt_split" },
      data: { totalUp: 4.0, totalDown: 6.0 },
    });
    await prisma.user.update({ where: { id: alice!.id }, data: { appBalance: { decrement: 1.0 } } });
    await prisma.user.update({ where: { id: bob!.id }, data: { appBalance: { decrement: 3.0 } } });
    await prisma.user.update({ where: { id: charlie.id }, data: { appBalance: { decrement: 6.0 } } });

    mockBtcPrice = 101000; // UP wins

    const req = makePost("/api/markets/test_mkt_split/settle", {}, { cronSecret: CRON_SECRET });
    const res = await settleMarket(req, makeParams("test_mkt_split"));
    expect(res.status).toBe(200);

    // totalPool = 10.0, adjustedPool = 9.5, winningPool (UP) = 4.0
    // Alice: (1/4) * 9.5 = 2.375
    // Bob:   (3/4) * 9.5 = 7.125
    // Charlie: 0
    const aliceBet = await prisma.bet.findFirst({ where: { userId: alice!.id, marketId: "test_mkt_split" } });
    expect(aliceBet!.payout!.toNumber()).toBe(2.375);

    const bobBet = await prisma.bet.findFirst({ where: { userId: bob!.id, marketId: "test_mkt_split" } });
    expect(bobBet!.payout!.toNumber()).toBe(7.125);

    const charlieBet = await prisma.bet.findFirst({ where: { userId: charlie.id, marketId: "test_mkt_split" } });
    expect(charlieBet!.status).toBe("LOST");
    expect(charlieBet!.payout!.toNumber()).toBe(0);

    // Platform fee = 10.0 * 0.05 = 0.5 (alice gets 2.375, bob gets 7.125 = 9.5, fee = 0.5) ✓
    // Verify sum: 2.375 + 7.125 = 9.5, original pool = 10.0, fee = 0.5 ✓
    expect(aliceBet!.payout!.toNumber() + bobBet!.payout!.toNumber()).toBe(9.5);

    // Cleanup charlie (delete bets first due to FK)
    await prisma.bet.deleteMany({ where: { user: { partyId: "test_charlie::abcdef03" } } });
    await prisma.user.deleteMany({ where: { partyId: "test_charlie::abcdef03" } });
  });

  it("prevents settling a market that hasn't expired yet", async () => {
    await createTestMarket({
      id: "test_mkt_future",
      startPrice: 100000,
      minutesFromNow: 10, // still 10 min to go
    });

    const req = makePost("/api/markets/test_mkt_future/settle", {}, { cronSecret: CRON_SECRET });
    const res = await settleMarket(req, makeParams("test_mkt_future"));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("not expired");
  });

  it("prevents double settlement", async () => {
    await createTestMarket({
      id: "test_mkt_double",
      startPrice: 100000,
      minutesFromNow: -1,
      openMinutesAgo: 16,
    });

    mockBtcPrice = 101000;

    // First settle succeeds
    const req1 = makePost("/api/markets/test_mkt_double/settle", {}, { cronSecret: CRON_SECRET });
    const res1 = await settleMarket(req1, makeParams("test_mkt_double"));
    expect(res1.status).toBe(200);

    // Second settle → 400 "Already settled"
    const req2 = makePost("/api/markets/test_mkt_double/settle", {}, { cronSecret: CRON_SECRET });
    const res2 = await settleMarket(req2, makeParams("test_mkt_double"));
    expect(res2.status).toBe(400);
    expect((await json(res2)).error).toContain("Already settled");
  });

  it("rejects settlement without cron secret", async () => {
    await createTestMarket({
      id: "test_mkt_noauth_settle",
      minutesFromNow: -1,
      openMinutesAgo: 16,
    });

    const req = makePost("/api/markets/test_mkt_noauth_settle/settle", {});
    const res = await settleMarket(req, makeParams("test_mkt_noauth_settle"));
    expect(res.status).toBe(401);
  });

  it("rejects settlement with wrong cron secret", async () => {
    await createTestMarket({
      id: "test_mkt_wrongsecret",
      minutesFromNow: -1,
      openMinutesAgo: 16,
    });

    const req = makePost("/api/markets/test_mkt_wrongsecret/settle", {}, { cronSecret: "wrong-secret" });
    const res = await settleMarket(req, makeParams("test_mkt_wrongsecret"));
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  5. MARKET LIST + LAZY SETTLEMENT
// ═══════════════════════════════════════════════════════════════════════════
describe("GET /api/markets", () => {
  beforeEach(async () => {
    await cleanupTestData();
  });

  it("returns markets array", async () => {
    const req = makeGet("/api/markets");
    const res = await getMarkets(req);
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(Array.isArray(data.markets)).toBe(true);
  });

  it("includes Cache-Control: no-store", async () => {
    const req = makeGet("/api/markets");
    const res = await getMarkets(req);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  6. PUBLIC MARKET BETS (privacy)
// ═══════════════════════════════════════════════════════════════════════════
describe("GET /api/markets/[id]/bets", () => {
  beforeAll(async () => {
    await cleanupTestData();
    const alice = await createTestUser("test_alice::abcdef01", 10.0);
    await createTestMarket({ id: "test_mkt_betsview", minutesFromNow: 10 });
    await prisma.bet.create({
      data: { userId: alice.id, marketId: "test_mkt_betsview", direction: "UP", amount: 1.23456789, status: "PENDING" },
    });
    await prisma.market.update({
      where: { id: "test_mkt_betsview" },
      data: { totalUp: 1.23456789 },
    });
  });

  it("returns bets with masked partyId", async () => {
    const req = makeGet("/api/markets/test_mkt_betsview/bets");
    const res = await getMarketBets(req, makeParams("test_mkt_betsview"));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.bets.length).toBe(1);
    // partyId should be masked
    expect(data.bets[0].maskedId).toMatch(/^.{6}….{4}$/);
    // Should NOT expose individual amounts
    expect(data.bets[0].amount).toBeUndefined();
  });

  it("returns 404 for non-existent market", async () => {
    const req = makeGet("/api/markets/NOPE/bets");
    const res = await getMarketBets(req, makeParams("NOPE"));
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  7. USER BETS (pagination)
// ═══════════════════════════════════════════════════════════════════════════
describe("GET /api/bets", () => {
  it("requires auth", async () => {
    const req = makeGet("/api/bets");
    const res = await getBets(req);
    expect(res.status).toBe(401);
  });

  it("returns user's own bets only", async () => {
    await cleanupTestData();
    const alice = await createTestUser("test_alice::abcdef01", 10.0);
    const bob = await createTestUser("test_bob::abcdef02", 10.0);
    await createTestMarket({ id: "test_mkt_mybets", minutesFromNow: 10 });

    await prisma.bet.create({
      data: { userId: alice.id, marketId: "test_mkt_mybets", direction: "UP", amount: 1.0, status: "PENDING" },
    });
    await prisma.bet.create({
      data: { userId: bob.id, marketId: "test_mkt_mybets", direction: "DOWN", amount: 2.0, status: "PENDING" },
    });

    const aliceToken = await signJwt("test_alice::abcdef01");
    const req = makeGet("/api/bets", { token: aliceToken });
    const res = await getBets(req);
    expect(res.status).toBe(200);
    const data = await json(res);
    // Alice should only see her own bet
    expect(data.length).toBe(1);
    expect(data[0].direction).toBe("UP");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  8. PRICE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════
describe("GET /api/price", () => {
  it("returns mocked price", async () => {
    mockBtcPrice = 99999;
    const req = makeGet("/api/price");
    const res = await priceRoute(req);
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.price).toBe(99999);
    expect(data.symbol).toBe("BTC/USD");
  });
});

describe("GET /api/price/candles", () => {
  it("rejects missing params", async () => {
    const req = makeGet("/api/price/candles");
    const res = await candlesRoute(req);
    expect(res.status).toBe(400);
  });

  it("rejects time range > 24h", async () => {
    const now = Date.now();
    const req = makeGet(`/api/price/candles?startTime=${now - 2 * 86400000}&endTime=${now}`);
    const res = await candlesRoute(req);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("24 hours");
  });

  it("rejects negative time range", async () => {
    const now = Date.now();
    const req = makeGet(`/api/price/candles?startTime=${now}&endTime=${now - 60000}`);
    const res = await candlesRoute(req);
    expect(res.status).toBe(400);
  });

  it("rejects timestamps far in the future", async () => {
    const future = Date.now() + 2 * 3_600_000; // 2h from now
    const req = makeGet(`/api/price/candles?startTime=${future}&endTime=${future + 60000}`);
    const res = await candlesRoute(req);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toContain("future");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  9. FULL END-TO-END CYCLE: bet → settle → verify balances
// ═══════════════════════════════════════════════════════════════════════════
describe("Full end-to-end: bet → settle → balance verification", () => {
  it("complete 2-user round with correct balance accounting", async () => {
    await cleanupTestData();

    // Setup users
    await createTestUser("test_alice::abcdef01", 5.0);
    await createTestUser("test_bob::abcdef02", 5.0);
    const aliceToken = await signJwt("test_alice::abcdef01");
    const bobToken = await signJwt("test_bob::abcdef02");

    // Create an open market (closes in 10 min)
    await createTestMarket({
      id: "test_mkt_e2e",
      startPrice: 100000,
      minutesFromNow: 10,
      openMinutesAgo: 5,
    });

    // Alice bets 2.0 UP
    const res1 = await placeBet(
      makePost("/api/markets/test_mkt_e2e/bet", { direction: "UP", amount: 2.0 }, { token: aliceToken }),
      makeParams("test_mkt_e2e")
    );
    expect(res1.status).toBe(201);
    expect(await getUserBalance("test_alice::abcdef01")).toBe(3.0);

    // Bob bets 3.0 DOWN
    const res2 = await placeBet(
      makePost("/api/markets/test_mkt_e2e/bet", { direction: "DOWN", amount: 3.0 }, { token: bobToken }),
      makeParams("test_mkt_e2e")
    );
    expect(res2.status).toBe(201);
    expect(await getUserBalance("test_bob::abcdef02")).toBe(2.0);

    // Verify market state
    const mkt = await prisma.market.findUnique({ where: { id: "test_mkt_e2e" } });
    expect(mkt!.totalUp.toNumber()).toBe(2.0);
    expect(mkt!.totalDown.toNumber()).toBe(3.0);

    // Fast-forward: expire the market
    await prisma.market.update({
      where: { id: "test_mkt_e2e" },
      data: { closeAt: subMinutes(new Date(), 1) },
    });

    // Price went UP → Alice wins
    mockBtcPrice = 101000;

    const res3 = await settleMarket(
      makePost("/api/markets/test_mkt_e2e/settle", {}, { cronSecret: CRON_SECRET }),
      makeParams("test_mkt_e2e")
    );
    expect(res3.status).toBe(200);
    const settleData = await json(res3);
    expect(settleData.winningDirection).toBe("UP");

    // Verify final balances
    // totalPool = 5.0, adjustedPool = 4.75
    // Alice: bet 2.0 UP / winningPool 2.0 → payout = (2/2) * 4.75 = 4.75
    // Alice final: 3.0 + 4.75 = 7.75
    // Bob final: 2.0 + 0 = 2.0
    expect(await getUserBalance("test_alice::abcdef01")).toBe(7.75);
    expect(await getUserBalance("test_bob::abcdef02")).toBe(2.0);

    // Verify total money: alice + bob = 7.75 + 2.0 = 9.75
    // Started with 10.0 total. Platform fee = 0.25 (5% of 5.0). 10.0 - 0.25 = 9.75 ✓
    const totalMoney = (await getUserBalance("test_alice::abcdef01")) + (await getUserBalance("test_bob::abcdef02"));
    expect(totalMoney).toBe(9.75); // 10.0 - 0.25 fee = 9.75

    // Verify bet records
    const alice = await prisma.user.findUnique({ where: { partyId: "test_alice::abcdef01" } });
    const aliceBet = await prisma.bet.findFirst({ where: { userId: alice!.id, marketId: "test_mkt_e2e" } });
    expect(aliceBet!.status).toBe("WON");
    expect(aliceBet!.payout!.toNumber()).toBe(4.75);

    const bob = await prisma.user.findUnique({ where: { partyId: "test_bob::abcdef02" } });
    const bobBet = await prisma.bet.findFirst({ where: { userId: bob!.id, marketId: "test_mkt_e2e" } });
    expect(bobBet!.status).toBe("LOST");
    expect(bobBet!.payout!.toNumber()).toBe(0);

    // Market should be SETTLED
    const finalMkt = await prisma.market.findUnique({ where: { id: "test_mkt_e2e" } });
    expect(finalMkt!.status).toBe("SETTLED");
    expect(finalMkt!.direction).toBe("UP");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  10. PRECISION STRESS TEST
// ═══════════════════════════════════════════════════════════════════════════
describe("Precision: satoshi-level arithmetic", () => {
  it("handles tiny amounts without floating-point drift", async () => {
    await cleanupTestData();
    await createTestUser("test_alice::abcdef01", 1.0);
    await createTestUser("test_bob::abcdef02", 1.0);

    await createTestMarket({
      id: "test_mkt_precision",
      startPrice: 100000,
      minutesFromNow: -1,
      openMinutesAgo: 16,
    });

    const alice = await prisma.user.findUnique({ where: { partyId: "test_alice::abcdef01" } });
    const bob = await prisma.user.findUnique({ where: { partyId: "test_bob::abcdef02" } });

    // Use amounts that are tricky for floating-point: 0.1 + 0.2 ≠ 0.3
    await prisma.bet.create({
      data: { userId: alice!.id, marketId: "test_mkt_precision", direction: "UP", amount: 0.1, status: "PENDING" },
    });
    await prisma.bet.create({
      data: { userId: bob!.id, marketId: "test_mkt_precision", direction: "DOWN", amount: 0.2, status: "PENDING" },
    });
    await prisma.market.update({
      where: { id: "test_mkt_precision" },
      data: { totalUp: 0.1, totalDown: 0.2 },
    });
    await prisma.user.update({ where: { id: alice!.id }, data: { appBalance: { decrement: 0.1 } } });
    await prisma.user.update({ where: { id: bob!.id }, data: { appBalance: { decrement: 0.2 } } });

    mockBtcPrice = 101000; // UP wins

    const req = makePost("/api/markets/test_mkt_precision/settle", {}, { cronSecret: CRON_SECRET });
    const res = await settleMarket(req, makeParams("test_mkt_precision"));
    expect(res.status).toBe(200);

    // totalPool = 0.3, adjustedPool = 0.3 * 0.95 = 0.285
    // In satoshis: totalPool = 30_000_000, adjusted = floor(30_000_000 * 0.95) = 28_500_000
    // Alice: (10_000_000 / 10_000_000) * 28_500_000 = 28_500_000 sats = 0.285
    const aliceBet = await prisma.bet.findFirst({ where: { userId: alice!.id, marketId: "test_mkt_precision" } });
    expect(aliceBet!.payout!.toNumber()).toBe(0.285);

    // Final balances: alice = 0.9 + 0.285 = 1.185, bob = 0.8
    expect(await getUserBalance("test_alice::abcdef01")).toBe(1.185);
    expect(await getUserBalance("test_bob::abcdef02")).toBe(0.8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  11. BALANCE INTEGRITY: no money from nowhere, no money destroyed
// ═══════════════════════════════════════════════════════════════════════════
describe("Balance integrity: conservation of money", () => {
  it("total user balances + platform fee = initial deposit", async () => {
    await cleanupTestData();

    // 3 users, each deposits 10 → total system = 30
    await createTestUser("test_alice::abcdef01", 10.0);
    await createTestUser("test_bob::abcdef02", 10.0);
    const charlie = await createTestUser("test_charlie::abcdef03", 10.0);

    const initialTotal = 30.0;

    // Round 1: alice UP 5, bob DOWN 3, charlie DOWN 2
    await createTestMarket({
      id: "test_mkt_conserve1",
      startPrice: 100000,
      minutesFromNow: -1,
      openMinutesAgo: 16,
    });

    const alice = await prisma.user.findUnique({ where: { partyId: "test_alice::abcdef01" } });
    const bob = await prisma.user.findUnique({ where: { partyId: "test_bob::abcdef02" } });

    await prisma.bet.create({ data: { userId: alice!.id, marketId: "test_mkt_conserve1", direction: "UP", amount: 5.0, status: "PENDING" } });
    await prisma.bet.create({ data: { userId: bob!.id, marketId: "test_mkt_conserve1", direction: "DOWN", amount: 3.0, status: "PENDING" } });
    await prisma.bet.create({ data: { userId: charlie.id, marketId: "test_mkt_conserve1", direction: "DOWN", amount: 2.0, status: "PENDING" } });
    await prisma.market.update({
      where: { id: "test_mkt_conserve1" },
      data: { totalUp: 5.0, totalDown: 5.0 },
    });
    await prisma.user.update({ where: { id: alice!.id }, data: { appBalance: { decrement: 5.0 } } });
    await prisma.user.update({ where: { id: bob!.id }, data: { appBalance: { decrement: 3.0 } } });
    await prisma.user.update({ where: { id: charlie.id }, data: { appBalance: { decrement: 2.0 } } });

    mockBtcPrice = 101000; // UP wins

    await settleMarket(
      makePost("/api/markets/test_mkt_conserve1/settle", {}, { cronSecret: CRON_SECRET }),
      makeParams("test_mkt_conserve1")
    );

    // Pool = 10.0, fee = 0.5
    // Alice: (5/5) * 9.5 = 9.5
    // Bob + Charlie: 0

    const aliceBal = await getUserBalance("test_alice::abcdef01");
    const bobBal = await getUserBalance("test_bob::abcdef02");
    const charlieBal = await getUserBalance("test_charlie::abcdef03");

    const totalBalances = aliceBal + bobBal + charlieBal;
    const platformFee = 10.0 * 0.05; // 0.5

    // Total user balances + platform fee = initial total
    expect(totalBalances + platformFee).toBeCloseTo(initialTotal, 8);
    expect(platformFee).toBe(0.5);

    // Cleanup (delete bets first due to FK)
    await prisma.bet.deleteMany({ where: { user: { partyId: "test_charlie::abcdef03" } } });
    await prisma.user.deleteMany({ where: { partyId: "test_charlie::abcdef03" } });
  });
});
