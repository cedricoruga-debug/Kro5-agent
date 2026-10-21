// Natural speech in and out through a hosted voice service. ElevenLabs is used when its key is set,
// otherwise OpenAI; with neither, the app falls back to the phone's built-in voice and speech recognition.

export type Provider = "elevenlabs" | "openai";
export type Voice = { id: string; name: string; about: string };

export function provider(): Provider | null {
  if (process.env.ELEVENLABS_API_KEY) return "elevenlabs";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
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

async function check(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  console.error(`${what} failed`, res.status, await res.text().catch(() => ""));
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
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
      // Flash is ElevenLabs' fastest model, which keeps the gap before KRO5 speaks short.
      body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5" }),
    });
    return check(res, "ElevenLabs speech");
  }
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: text, instructions: STYLE, response_format: "mp3" }),
  });
  return check(res, "OpenAI speech");
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
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
      body: form,
    });
  } else {
    form.append("model", "gpt-4o-mini-transcribe");
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
  }
  const { text } = (await (await check(res, "Transcription")).json()) as { text?: string };
  return (text ?? "").trim();
}
