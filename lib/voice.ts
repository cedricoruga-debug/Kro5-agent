// Natural speech in and out through a hosted voice service. ElevenLabs is used when its key is set,
// otherwise OpenAI; with neither, the app falls back to the phone's built-in voice and speech recognition.

export type Provider = "elevenlabs" | "openai";
export type Voice = { id: string; name: string; about: string };

// A key pasted into Vercel can pick up spaces, a line break or quotes; the services reject it with them.
function key(name: "ELEVENLABS_API_KEY" | "OPENAI_API_KEY"): string {
  return (process.env[name] ?? "").trim().replace(/^["']|["']$/g, "").trim();
}

export function provider(): Provider | null {
  if (key("ELEVENLABS_API_KEY")) return "elevenlabs";
  if (key("OPENAI_API_KEY")) return "openai";
  return null;
}

// The voice service turned the key down, so every request will fail until Ced replaces it in Vercel.
export class VoiceKeyError extends Error {
  constructor(p: Provider) {
    const name = p === "elevenlabs" ? "ElevenLabs" : "OpenAI";
    const env = p === "elevenlabs" ? "ELEVENLABS_API_KEY" : "OPENAI_API_KEY";
    super(`${name} rejected KRO5's API key. Replace ${env} in Vercel and redeploy.`);
  }
}

// The first voice in each list is the default.
export const VOICES: Record<Provider, Voice[]> = {
  elevenlabs: [
    { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", about: "British, warm" },
    { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", about: "British, authoritative" },
    { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", about: "British, confident" },
    { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", about: "British, calm" },
    { id: "nPczCjzI2devNBz1zQrb", name: "Brian", about: "American, deep" },
    { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", about: "American, friendly" },
  ],
  openai: [
    { id: "fable", name: "Fable", about: "British" },
    { id: "onyx", name: "Onyx", about: "Deep" },
    { id: "ash", name: "Ash", about: "Clear" },
    { id: "sage", name: "Sage", about: "Calm" },
    { id: "coral", name: "Coral", about: "Warm" },
    { id: "nova", name: "Nova", about: "Bright" },
  ],
};

// How the OpenAI voice should sound; ElevenLabs voices carry their own character.
const STYLE = "Calm, warm and quietly confident, like a capable personal assistant. Natural pace, light British accent.";

function pickVoice(p: Provider, id: string | undefined): string {
  return VOICES[p].find((v) => v.id === id)?.id ?? VOICES[p][0].id;
}

async function check(res: Response, what: string, p: Provider): Promise<Response> {
  if (res.ok) return res;
  console.error(`${what} failed`, res.status, await res.text().catch(() => ""));
  if (res.status === 401 || res.status === 403) throw new VoiceKeyError(p);
  throw new Error(`${what} failed (${res.status})`);
}

// Returns MP3 audio for one or two sentences of text.
export async function speak(text: string, voiceId?: string): Promise<Response> {
  const p = provider();
  if (!p) throw new Error("No voice service is configured.");
  const voice = pickVoice(p, voiceId);
  if (p === "elevenlabs") {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key("ELEVENLABS_API_KEY"), "Content-Type": "application/json" },
      // Flash is ElevenLabs' fastest model, which keeps the gap before KRO5 speaks short.
      body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5" }),
    });
    return check(res, "ElevenLabs speech", p);
  }
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: text, instructions: STYLE, response_format: "mp3" }),
  });
  return check(res, "OpenAI speech", p);
}

// Turns a recording from the phone into text.
export async function transcribe(audio: Blob, filename: string): Promise<string> {
  const p = provider();
  if (!p) throw new Error("No voice service is configured.");
  const form = new FormData();
  form.append("file", audio, filename);
  let res: Response;
  if (p === "elevenlabs") {
    form.append("model_id", process.env.ELEVENLABS_STT_MODEL ?? "scribe_v1");
    form.append("tag_audio_events", "false");
    res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": key("ELEVENLABS_API_KEY") },
      body: form,
    });
  } else {
    form.append("model", "gpt-4o-mini-transcribe");
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key("OPENAI_API_KEY")}` },
      body: form,
    });
  }
  const { text } = (await (await check(res, "Transcription", p)).json()) as { text?: string };
  return (text ?? "").trim();
}
