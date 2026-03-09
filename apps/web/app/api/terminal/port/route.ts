import { NextResponse } from "next/server";
import { getTerminalPort } from "@/lib/terminal-server";

export const dynamic = "force-dynamic";

export function GET() {
  const port = getTerminalPort();
  return NextResponse.json({ port });
}
