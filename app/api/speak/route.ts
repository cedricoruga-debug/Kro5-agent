import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { speak } from "@/lib/voice";

// One sentence or two of KRO5's reply, as MP3.
export async function POST(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { text, voice } = (await request.json().catch(() => ({}))) as { text?: unknown; voice?: unknown };
  if (typeof text !== "string" || !text.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
  try {
    const audio = await speak(text.trim().slice(0, 1500), typeof voice === "string" ? voice : undefined);
    return new Response(audio.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Speech failed" }, { status: 502 });
  }
}
