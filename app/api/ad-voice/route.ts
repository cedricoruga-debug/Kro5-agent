import { NextResponse } from "next/server";

// TEMPORARY (kro5.app ad voiceover): renders the ad's fixed script with ElevenLabs and
// returns the clips as base64 MP3. Preview deployments only; the script can't be changed
// from outside, so the key can only ever be spent on these lines. Remove after use.
export const maxDuration = 60;

const VOICES: Record<string, string> = {
  alice: "Xb7hH8MSUJpSbSDYk0k2",
  brian: "nPczCjzI2devNBz1zQrb",
  jessica: "cgSgspJ2msm6clMCkdW9",
  matilda: "XrExE9yKIg1WjnnlVkGX",
};

const LINES = [
  "[tired] Monday morning... Your VAs clock in, in the group chat. [sighs] Clients want updates. And the timesheet? Broken. Again.",
  "[firmly] Stop running your agency from a group chat.",
  "[warmly] This is Crow Five. The workspace for VA agencies.",
  "[upbeat] Your VAs clock in per client, right from their phone.",
  "You approve every timesheet, in one place.",
  "Payslips come straight from the hours you approved.",
  "Invoices from the same hours. And you see what's paid.",
  "[curious] And if your VAs or clients need something special? [warmly] We build it for you, right into your workspace.",
  "[pleased] Your clients see the work... without having to ask.",
  "[relieved] So on Friday? Payday is quiet.",
  "[warmly] Crow Five. Run your agency from one place. Book a demo at crow five dot app.",
];

async function one(voice: string, text: string, model: string): Promise<string> {
  const body = model === "eleven_v3" ? { text, model_id: model } : { text: text.replace(/\[[^\]]+\]\s*/g, ""), model_id: model, voice_settings: { stability: 0.35, similarity_boost: 0.8, style: 0.45 } };
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": (process.env.ELEVENLABS_API_KEY ?? "").trim(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") return NextResponse.json({ error: "not here" }, { status: 404 });
  const q = new URL(request.url).searchParams;
  const voice = VOICES[q.get("voice") ?? "alice"];
  const model = q.get("model") === "v2" ? "eleven_multilingual_v2" : "eleven_v3";
  if (!voice) return NextResponse.json({ error: "voice" }, { status: 400 });
  const from = Math.max(0, Number(q.get("from") ?? 0)), to = Math.min(LINES.length, Number(q.get("to") ?? LINES.length));
  const out: { i: number; mp3?: string; error?: string }[] = [];
  // ElevenLabs allows only a few requests at once on this plan, so two at a time.
  for (let i = from; i < to; i += 2) {
    const batch = [i, i + 1].filter((k) => k < to);
    out.push(...(await Promise.all(batch.map(async (k) => {
      try {
        return { i: k, mp3: await one(voice, LINES[k], model) };
      } catch (e) {
        return { i: k, error: String(e) };
      }
    }))));
  }
  return NextResponse.json({ model, out });
}
