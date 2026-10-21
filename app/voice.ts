"use client";

// Hands-free voice on the phone when a hosted voice service is set up (see lib/voice.ts):
// replies play as natural speech, and Ced's turns are recorded with a pause detector and transcribed on the
// server. Unlike the browser's speech recognition, iPhone lets a page reopen the mic without a tap, so a
// conversation can go back and forth without touching the screen.

export type SpeakerLike = {
  push(text: string): void;
  end(): void;
  stop(): void;
  readonly speaking: boolean;
};

// Safari 17+: route web audio as media playback so replies aren't muted by the silent switch.
export function setAudioSession(type: "auto" | "playback" | "play-and-record") {
  try {
    const session = (navigator as any).audioSession;
    if (session) session.type = type;
  } catch {}
}

// A tenth of a second of silence as a WAV file, for unlocking playback during a tap.
function silence(): string {
  const rate = 8000;
  const samples = rate / 10;
  const view = new DataView(new ArrayBuffer(44 + samples));
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) view.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([view], { type: "audio/wav" }));
}

// iOS only lets a page play sound without a tap through an audio element that already played during a tap,
// so every reply goes through this one element.
let player: HTMLAudioElement | null = null;
let analysis: AudioContext | null = null;

// Call during a tap. Unlocks reply playback and the pause detector for the rest of the visit.
export function unlockAudio() {
  player ??= new Audio();
  player.src = silence();
  void player.play().catch(() => {});
  try {
    analysis ??= new AudioContext();
    void analysis.resume();
  } catch {}
}

function play(url: string, isStopped: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (!player || isStopped()) return resolve();
    const audio = player;
    const done = () => {
      audio.onended = audio.onerror = audio.onpause = null;
      resolve();
    };
    audio.onended = audio.onerror = done;
    audio.src = url;
    audio.play().then(() => (audio.onpause = done), done);
  });
}

// Speaks a streaming reply a sentence at a time in the voice Ced picked. Each sentence's audio is
// requested as soon as the sentence is complete, and they play in order.
export class ServerSpeaker implements SpeakerLike {
  private buffer = "";
  private pending = 0;
  private ended = false;
  private stopped = false;
  private chain: Promise<void> = Promise.resolve();
  private urls: string[] = [];

  constructor(
    private voice: string,
    private onDone: () => void,
  ) {
    setAudioSession("playback");
  }

  push(text: string) {
    if (this.stopped) return;
    this.buffer += text;
    const match = this.buffer.match(/^[\s\S]*[.!?](?=\s)/);
    if (match) {
      this.say(match[0]);
      this.buffer = this.buffer.slice(match[0].length);
    }
  }

  end() {
    if (this.stopped) return;
    this.say(this.buffer);
    this.buffer = "";
    this.ended = true;
    this.check();
  }

  stop() {
    this.stopped = true;
    player?.pause();
    this.urls.forEach((url) => URL.revokeObjectURL(url));
  }

  get speaking() {
    return this.pending > 0;
  }

  private say(text: string) {
    const sentence = text.trim();
    if (!sentence) return;
    this.pending++;
    const audio = fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sentence, voice: this.voice }),
    })
      .then((res) => (res.ok ? res.blob() : null))
      .catch(() => null);
    this.chain = this.chain.then(async () => {
      const blob = await audio;
      if (blob && !this.stopped) {
        const url = URL.createObjectURL(blob);
        this.urls.push(url);
        await play(url, () => this.stopped);
      }
      this.pending--;
      this.check();
    });
  }

  private check() {
    if (this.ended && this.pending === 0 && !this.stopped) {
      this.stopped = true;
      this.urls.forEach((url) => URL.revokeObjectURL(url));
      this.onDone();
    }
  }
}

// Plays one sample sentence, so Ced can hear a voice before picking it. Call during a tap.
export function preview(voice: string, text: string) {
  unlockAudio();
  const speaker = new ServerSpeaker(voice, () => {});
  speaker.push(text);
  speaker.end();
  return speaker;
}

// Recording ends after this much quiet once Ced has started talking.
const SILENCE_MS = 1300;
// Speech must last this long to count, so a cough or a door doesn't start a turn.
const MIN_SPEECH_MS = 250;
const TICK_MS = 50;

export type Heard = { audio: Blob; filename: string } | null;

// Opens the mic, waits for Ced to talk, and resolves with the recording once they pause.
// Resolves null if nobody speaks within `waitMs` or the turn is cancelled.
export class MicTurn {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private finish: ((heard: Heard) => void) | null = null;
  private spoke = false;
  private cancelled = false;

  // `autoSend` ends the turn when Ced pauses (hands-free); otherwise it waits for a tap.
  // `onSpeech` fires once when Ced starts talking.
  constructor(
    private waitMs: number,
    private autoSend: boolean,
    private onSpeech: () => void,
  ) {}

  async start(): Promise<Heard> {
    setAudioSession("play-and-record");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    this.recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const result = new Promise<Heard>((resolve) => (this.finish = resolve));
    this.recorder.onstop = () => {
      this.release();
      const mime = this.recorder?.mimeType || type || "audio/webm";
      const ext = mime.includes("mp4") ? "mp4" : "webm";
      this.finish?.(this.spoke && !this.cancelled ? { audio: new Blob(chunks, { type: mime }), filename: `speech.${ext}` } : null);
    };
    this.recorder.start();
    this.detect();
    return result;
  }

  // Ced tapped to send: stop now and use what was recorded, whether or not a pause was heard.
  send() {
    this.spoke = true;
    this.stopRecording();
  }

  cancel() {
    this.cancelled = true;
    if (this.recorder && this.recorder.state !== "inactive") this.stopRecording();
    else {
      this.release();
      this.finish?.(null);
    }
  }

  private stopRecording() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.recorder?.state !== "inactive") this.recorder?.stop();
  }

  // Watches the mic level: learns the room's noise for a moment, then treats anything well above it as speech.
  private detect() {
    const started = Date.now();
    let analyser: AnalyserNode | null = null;
    try {
      if (analysis && this.stream) {
        void analysis.resume();
        analyser = analysis.createAnalyser();
        analyser.fftSize = 1024;
        analysis.createMediaStreamSource(this.stream).connect(analyser);
      }
    } catch {
      analyser = null;
    }
    const samples = new Float32Array(1024);
    let floor = 0.01;
    let loudSince = 0;
    let quietSince = 0;
    this.timer = setInterval(() => {
      const now = Date.now();
      if (!analyser) {
        // No level meter (the audio context didn't start): fall back to tap to send.
        this.spoke = true;
        return;
      }
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      const level = Math.sqrt(sum / samples.length);
      if (now - started < 300) {
        floor = Math.max(floor, level);
        return;
      }
      const threshold = Math.max(0.02, floor * 2.5);
      if (level > threshold) {
        quietSince = 0;
        loudSince ||= now;
        if (!this.spoke && now - loudSince >= MIN_SPEECH_MS) {
          this.spoke = true;
          this.onSpeech();
        }
      } else {
        loudSince = 0;
        quietSince ||= now;
        if (this.autoSend && this.spoke && now - quietSince >= SILENCE_MS) this.stopRecording();
      }
      if (!this.spoke && now - started >= this.waitMs) this.cancel();
    }, TICK_MS);
  }

  // Closing the tracks turns off the iPhone's mic indicator.
  private release() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

export async function transcribe({ audio, filename }: NonNullable<Heard>): Promise<string> {
  const form = new FormData();
  form.append("audio", audio, filename);
  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (res.status === 401) {
    window.location.reload();
    return "";
  }
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Couldn't make out what you said.");
  return data.text ?? "";
}
