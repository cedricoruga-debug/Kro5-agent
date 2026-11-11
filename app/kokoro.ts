// Kokoro is a free, open-source voice (Apache licence) that runs in the browser on Ced's phone, so speaking
// costs nothing. Voice ids carry a "kokoro:" prefix so they can't be mistaken for an ElevenLabs id.
// Until the model has downloaded, or if the phone can't run it, speech falls back to the hosted voice.
import type { Voice } from "@/lib/voice";

const PREFIX = "kokoro:";

// The first voice is the default for KRO5 herself. Kokoro grades these voices; the best ones are listed first.
export const KOKORO_VOICES: Voice[] = [
  { id: "kokoro:af_heart", name: "Heart", about: "American, warm" },
  { id: "kokoro:af_bella", name: "Bella", about: "American, bright" },
  { id: "kokoro:bf_emma", name: "Emma", about: "British, clear" },
  { id: "kokoro:af_nicole", name: "Nicole", about: "American, soft" },
  { id: "kokoro:af_aoede", name: "Aoede", about: "American, smooth" },
  { id: "kokoro:af_kore", name: "Kore", about: "American, steady" },
  { id: "kokoro:bf_isabella", name: "Isabella", about: "British, gentle" },
];

// Each teammate's Kokoro voice, by team handle (see lib/team.ts and TEAM_VOICES in lib/voice.ts).
export const KOKORO_TEAM: Record<string, string> = {
  "Chief of Staff": "kokoro:af_bella",
  CFO: "kokoro:am_michael",
  CMO: "kokoro:af_kore",
  COO: "kokoro:am_fenrir",
  CTO: "kokoro:am_puck",
  "General Counsel": "kokoro:bf_emma",
  "VA Lead": "kokoro:af_sarah",
  "Courts Lead": "kokoro:bm_fable",
  Chair: "kokoro:bm_george",
  "Independent Director": "kokoro:bm_lewis",
};

export const isKokoro = (voice: string) => voice.startsWith(PREFIX);

export type KokoroState = { state: "off" | "loading" | "ready" | "failed"; share?: number; error?: string };

let worker: Worker | null = null;
let status: KokoroState = { state: "off" };
let nextId = 1;
const waiting = new Map<number, (audio: Blob | null) => void>();
const watchers = new Set<(state: KokoroState) => void>();

function set(next: KokoroState) {
  status = next;
  watchers.forEach((watch) => watch(status));
}

// Running Kokoro can take more memory than a phone browser gives a page, and the page then crashes and
// reloads. A flag is kept in storage while Kokoro is loaded and the page is on screen; finding it at the next
// start means the page died with Kokoro running, so the app goes back to the hosted voice.
const RUNNING_KEY = "kro5.kokoro.running";

function mark(on: boolean) {
  try {
    if (on) localStorage.setItem(RUNNING_KEY, "1");
    else localStorage.removeItem(RUNNING_KEY);
  } catch {}
}

// True once if the last page crashed while Kokoro was running.
export function kokoroCrashed(): boolean {
  try {
    const crashed = localStorage.getItem(RUNNING_KEY) === "1";
    localStorage.removeItem(RUNNING_KEY);
    return crashed;
  } catch {
    return false;
  }
}

// Starts the download (once) and tells `watch` how it's going. Returns a function that stops watching.
export function startKokoro(watch?: (state: KokoroState) => void) {
  if (watch) {
    watchers.add(watch);
    watch(status);
  }
  if (worker && status.state === "failed") {
    // Try again, say after the phone was offline the first time.
    set({ state: "loading", share: 0 });
    worker.postMessage({ type: "load" });
  } else if (!worker && typeof Worker !== "undefined") {
    try {
      worker = new Worker(new URL("./kokoro-worker.ts", import.meta.url), { type: "module" });
    } catch (error: any) {
      set({ state: "failed", error: String(error?.message ?? error) });
      return () => watch && watchers.delete(watch);
    }
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data.type === "progress") set({ state: "loading", share: data.share });
      else if (data.type === "ready") set({ state: "ready" });
      else if (data.type === "failed") {
        set({ state: "failed", error: data.error });
        mark(false);
      }
      else if (data.type === "audio") {
        waiting.get(data.id)?.(data.audio);
        waiting.delete(data.id);
      }
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      mark(false);
      set({ state: "failed", error: "Kokoro couldn't start on this phone." });
      waiting.forEach((done) => done(null));
      waiting.clear();
    };
    set({ state: "loading", share: 0 });
    worker.postMessage({ type: "load" });
    // Leaving the page normally (or putting it in the background) isn't a crash.
    mark(true);
    document.addEventListener("visibilitychange", () => mark(document.visibilityState === "visible" && worker !== null));
    window.addEventListener("pagehide", () => mark(false));
  }
  return () => watch && watchers.delete(watch);
}

// Voices one chunk as a WAV file, or null when Kokoro isn't ready so the caller can use another voice.
export function kokoroAudio(text: string, voice: string): Promise<Blob | null> {
  if (status.state !== "ready" || !worker) return Promise.resolve(null);
  const id = nextId++;
  return new Promise((done) => {
    waiting.set(id, done);
    worker!.postMessage({ type: "say", id, text, voice: voice.slice(PREFIX.length) });
  });
}
