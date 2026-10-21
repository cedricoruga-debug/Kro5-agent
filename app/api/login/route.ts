import { NextResponse } from "next/server";
import { SESSION_COOKIE, checkPasscode, createSessionToken, sessionCookieOptions } from "@/lib/auth";

export async function POST(request: Request) {
  const { passcode } = (await request.json()) as { passcode?: string };
  if (!passcode || !checkPasscode(passcode)) {
    return NextResponse.json({ error: "Wrong passcode" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions());
  return response;
}
