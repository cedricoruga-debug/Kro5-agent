import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { transcribe, VoiceKeyError } from "@/lib/voice";

const MAX_BYTES = 4 * 1024 * 1024;

// What Ced said, from a recording the app made while hands-free.
export async function POST(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: "audio required" }, { status: 400 });
  if (audio.size > MAX_BYTES) return NextResponse.json({ error: "That recording is too long." }, { status: 413 });
  try {
    const name = audio instanceof File && audio.name ? audio.name : "speech.webm";
    const started = Date.now();
    const text = await transcribe(audio, name);
    console.info("transcribe", JSON.stringify({ bytes: audio.size, ms: Date.now() - started }));
    return NextResponse.json({ text });
  } catch (err) {
    const code = err instanceof VoiceKeyError ? "voice_key" : undefined;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Transcription failed", code }, { status: 502 });
  }
}
