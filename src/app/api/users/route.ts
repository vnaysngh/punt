import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/users - upsert user after wallet connect
export async function POST(req: NextRequest) {
  try {
    const { partyId, email, publicKey } = await req.json();

    if (!partyId) {
      return NextResponse.json({ error: "partyId required" }, { status: 400 });
    }

    const user = await prisma.user.upsert({
      where: { partyId },
      update: { email, publicKey },
      create: { partyId, email, publicKey, appBalance: 0 },
    });

    return NextResponse.json(user);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/users?partyId=xxx
export async function GET(req: NextRequest) {
  try {
    const partyId = req.nextUrl.searchParams.get("partyId");
    if (!partyId) {
      return NextResponse.json({ error: "partyId required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { partyId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
