import { NextResponse } from "next/server";

// TEMPORARY (kro5.app ad voice sampler): two fixed ad lines in a fixed set of ElevenLabs
// voices, returned as base64 MP3. Preview deployments only; nothing can be changed from
// outside, so the key can only ever be spent on these lines. Remove after use.
export const maxDuration = 60;

const VOICES: Record<string, string> = {
  jessica: "cgSgspJ2msm6clMCkdW9",
  sarah: "EXAVITQu4vr4xnSDxMaL",
  matilda: "XrExE9yKIg1WjnnlVkGX",
  laura: "FGY2WhTYpPnrIDTdsKH5",
  charlotte: "XB0fDUnXU5powFXDhCwa",
  charlie: "IKne3meq5aSn9XLyUdCD",
  eric: "cjVigY5qzO86Huf0OWal",
  will: "bIHbv24MWmeRgasZH58o",
  chris: "iP95p4xoKVk53GoZ742B",
  george: "JBFqnCBsd6RMkjVDRZzb",
};

const LINES = [
  "[tired] Monday morning... Your VAs clock in, in the group chat. [sighs] Clients want updates. And the timesheet? Broken. Again.",
  "[warmly] Crow Five. Run your agency from one place. Book a demo at crow five dot app.",
];

async function one(voice: string, text: string): Promise<string> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": (process.env.ELEVENLABS_API_KEY ?? "").trim(), "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_v3" }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") return NextResponse.json({ error: "not here" }, { status: 404 });
  const names = (new URL(request.url).searchParams.get("voices") ?? "").split(",").filter((n) => n in VOICES).slice(0, 3);
  const out: { voice: string; i: number; mp3?: string; error?: string }[] = [];
  for (const n of names) {
    out.push(...(await Promise.all(LINES.map(async (text, i) => {
      try {
        return { voice: n, i, mp3: await one(VOICES[n], text) };
      } catch (e) {
        return { voice: n, i, error: String(e) };
      }
    }))));
  }
  return NextResponse.json({ out });
}
