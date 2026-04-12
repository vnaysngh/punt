import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBtcPrice } from "@/lib/price";
import { addMinutes } from "date-fns";

async function ensureSingleMarket() {
  const now = new Date();

  // Close expired open markets
  await prisma.market.updateMany({
    where: { status: "OPEN", closeAt: { lte: now } },
    data: { status: "CLOSED" },
  });

  // If there's already an open market, do nothing
  const existing = await prisma.market.findFirst({ where: { status: "OPEN" } });
  if (existing) return existing;

  // Create the one BTC market with live price
  const startPrice = await getBtcPrice();
  return prisma.market.create({
    data: {
      question: "What will BTC/USD be in 15 minutes?",
      assetPair: "BTC/USD",
      category: "crypto",
      startPrice,
      openAt: now,
      closeAt: addMinutes(now, 15),
      status: "OPEN",
    },
  });
}

// GET — called by Vercel Cron every 15 min
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const market = await ensureSingleMarket();
  return NextResponse.json({ market });
}

// POST — called on app startup / page load to bootstrap if empty
export async function POST() {
  const market = await ensureSingleMarket();
  return NextResponse.json({ market });
}
