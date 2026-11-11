import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { speak, VoiceKeyError } from "@/lib/voice";

// One sentence or two of KRO5's reply, as MP3.
export async function POST(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { text, voice } = (await request.json().catch(() => ({}))) as { text?: unknown; voice?: unknown };
  if (typeof text !== "string" || !text.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
  const started = Date.now();
  try {
    const audio = await speak(text.trim().slice(0, 1500), typeof voice === "string" ? voice : undefined);
    console.info("speak", JSON.stringify({ chars: text.trim().length, ms: Date.now() - started }));
    return new Response(audio.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (err) {
    const code = err instanceof VoiceKeyError ? "voice_key" : undefined;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Speech failed", code }, { status: 502 });
  }
}
