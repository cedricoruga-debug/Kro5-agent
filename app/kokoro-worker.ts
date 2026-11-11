// Runs Kokoro, a free open-source voice, on the phone itself, off the main thread so the office keeps moving
// while a sentence is being voiced. The model (about 90 MB) downloads once and the browser keeps it.
import { KokoroTTS } from "kokoro-js";

type Ask = { type: "load" } | { type: "say"; id: number; text: string; voice: string };

let tts: Promise<KokoroTTS> | null = null;
// One sentence at a time: the phone has one model and a few cores.
let queue: Promise<void> = Promise.resolve();

function load() {
  tts ??= KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p: { status: string; loaded?: number; total?: number; file?: string }) => {
      if (p.status === "progress" && p.file?.endsWith(".onnx") && p.total) {
        postMessage({ type: "progress", share: (p.loaded ?? 0) / p.total });
      }
    },
  });
  return tts;
}

self.onmessage = (event: MessageEvent<Ask>) => {
  const ask = event.data;
  if (ask.type === "load") {
    load().then(
      () => postMessage({ type: "ready" }),
      (error) => {
        tts = null;
        postMessage({ type: "failed", error: String(error?.message ?? error) });
      },
    );
    return;
  }
  queue = queue.then(async () => {
    try {
      const model = await load();
      const audio = await model.generate(ask.text, { voice: ask.voice as any });
      postMessage({ type: "audio", id: ask.id, audio: audio.toBlob() });
    } catch (error: any) {
      postMessage({ type: "audio", id: ask.id, audio: null, error: String(error?.message ?? error) });
    }
  });
};
