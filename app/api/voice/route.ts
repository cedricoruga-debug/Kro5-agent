import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { BUILD, BUILD_HEADER } from "@/lib/build";
import { provider, TEAM_VOICES, VOICES } from "@/lib/voice";

export const dynamic = "force-dynamic";

// Which voice service is set up, the voices Ced can pick from for the assistant, and each teammate's voice. No service means the phone's own voice.
export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const p = provider();
  return NextResponse.json({ provider: p, voices: p ? VOICES[p] : [], teamVoices: p ? TEAM_VOICES[p] : {} }, { headers: { "Cache-Control": "no-store", [BUILD_HEADER]: BUILD } });
}
