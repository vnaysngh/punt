import { NextResponse } from "next/server";
import { getBtcPrice } from "@/lib/price";

export async function GET() {
  try {
    const price = await getBtcPrice();
    return NextResponse.json({ price, symbol: "BTC/USD", ts: Date.now() });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch price" }, { status: 502 });
  }
}
