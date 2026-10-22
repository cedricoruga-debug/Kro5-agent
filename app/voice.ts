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

// Sends what happened in a voice turn to the server log (no audio, no words), so problems on the phone can be
// diagnosed from Vercel's logs.
export function report(event: string, data: Record<string, unknown> = {}) {
  try {
    void fetch("/api/voice-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, ...data }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Speaks one sentence in the phone's built-in voice. Used when the voice service fails, so KRO5 isn't silent.
function speakBuiltIn(text: string, isStopped: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window) || isStopped()) return resolve();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

// An error from the voice routes; `code` is "voice_key" when the service rejected the API key.
export class VoiceError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

// Told once per reply when the voice service fails, with the server's explanation.
let onVoiceProblem: ((error: VoiceError) => void) | null = null;
export function whenVoiceFails(handler: (error: VoiceError) => void) {
  onVoiceProblem = handler;
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

// After the first sentence, text is sent to the voice service in chunks of at least this many characters,
// so a long reply needs only a few requests.
const CHUNK_CHARS = 160;
// The voice service plan allows only a few requests at once: one chunk plays while the next is fetched.
const MAX_IN_FLIGHT = 2;

// Speaks a streaming reply in the voice Ced picked. The first sentence is voiced on its own so KRO5 starts
// talking quickly; the rest goes in larger chunks. Chunks play in order.
export class ServerSpeaker implements SpeakerLike {
  private buffer = "";
  private held = "";
  private sentFirst = false;
  private pending = 0;
  private ended = false;
  private stopped = false;
  private chain: Promise<void> = Promise.resolve();
  private urls: string[] = [];
  private inFlight = 0;
  private waiting: (() => void)[] = [];
  private startedAt = Date.now();
  private firstAudioAt = 0;

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
    if (!match) return;
    this.buffer = this.buffer.slice(match[0].length);
    this.held += match[0];
    if (!this.sentFirst || this.held.length >= CHUNK_CHARS) this.flush();
  }

  end() {
    if (this.stopped) return;
    this.held += this.buffer;
    this.buffer = "";
    this.flush();
    this.ended = true;
    this.check();
  }

  stop() {
    this.stopped = true;
    player?.pause();
    this.urls.forEach((url) => URL.revokeObjectURL(url));
    this.waiting.splice(0).forEach((go) => go());
  }

  get speaking() {
    return this.pending > 0;
  }

  private flush() {
    const text = this.held.trim();
    this.held = "";
    if (!text) return;
    this.sentFirst = true;
    this.say(text);
  }

  private async slot() {
    while (this.inFlight >= MAX_IN_FLIGHT && !this.stopped) await new Promise<void>((go) => this.waiting.push(go));
    this.inFlight++;
  }

  private release() {
    this.inFlight--;
    this.waiting.shift()?.();
  }

  // Fetches one chunk's audio, retrying when the service is busy. Null means use the built-in voice.
  private async fetchAudio(text: string): Promise<Blob | null> {
    await this.slot();
    try {
      for (let attempt = 0; attempt < 4 && !this.stopped; attempt++) {
        const res = await fetch("/api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice: this.voice }),
        }).catch(() => null);
        if (res?.ok) return await res.blob();
        const data = (await res?.json().catch(() => ({}))) as { error?: string; code?: string } | undefined;
        if (data?.code === "voice_key") {
          this.fail(new VoiceError(data.error ?? "The voice service rejected its key.", data.code));
          return null;
        }
        await sleep(400 * 2 ** attempt);
      }
      report("speak_failed", { chars: text.length });
      return null;
    } finally {
      this.release();
    }
  }

  private say(text: string) {
    this.pending++;
    const audio = this.fetchAudio(text);
    this.chain = this.chain.then(async () => {
      const blob = await audio;
      if (blob && !this.stopped) {
        const url = URL.createObjectURL(blob);
        this.urls.push(url);
        if (!this.firstAudioAt) {
          this.firstAudioAt = Date.now();
          report("first_audio", { ms: this.firstAudioAt - this.startedAt });
        }
        await play(url, () => this.stopped);
      } else if (!this.stopped) await speakBuiltIn(text, () => this.stopped);
      this.pending--;
      this.check();
    });
  }

  private failed = false;

  private fail(error: VoiceError) {
    if (this.failed) return;
    this.failed = true;
    onVoiceProblem?.(error);
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
const SILENCE_MS = 1000;
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
  private started = 0;
  private peak = 0;
  private threshold = 0;
  private remetered = false;
  private how = "";

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
      report("listen_end", { how: this.how || "stopped", spoke: this.spoke, ms: Date.now() - this.started, peak: +this.peak.toFixed(3), threshold: +this.threshold.toFixed(3), autoSend: this.autoSend });
      const mime = this.recorder?.mimeType || type || "audio/webm";
      const ext = mime.includes("mp4") ? "mp4" : "webm";
      this.finish?.(this.spoke && !this.cancelled ? { audio: new Blob(chunks, { type: mime }), filename: `speech.${ext}` } : null);
    };
    this.recorder.start();
    this.started = Date.now();
    await this.detect();
    return result;
  }

  // Ced tapped to send: stop now and use what was recorded, whether or not a pause was heard.
  send() {
    this.how ||= "tap";
    this.spoke = true;
    this.stopRecording();
  }

  cancel() {
    this.how ||= "cancel";
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

  // A running audio context to measure the mic level. iPhone suspends or interrupts the one unlocked by the
  // first tap once KRO5 has played audio, but lets a page start one while the mic is open, so it's resumed or
  // replaced here, after the mic is on.
  private async meter(): Promise<AnalyserNode | null> {
    const running = () => analysis?.state === "running";
    try {
      if (!analysis || analysis.state === "closed") analysis = new AudioContext();
      if (!running()) await Promise.race([analysis.resume(), sleep(400)]);
      if (!running()) {
        void analysis.close().catch(() => {});
        analysis = new AudioContext();
        await Promise.race([analysis.resume(), sleep(400)]);
      }
      if (!running() || !this.stream) return null;
      const analyser = analysis.createAnalyser();
      analyser.fftSize = 1024;
      analysis.createMediaStreamSource(this.stream).connect(analyser);
      return analyser;
    } catch {
      return null;
    }
  }

  // Watches the mic level: learns the room's noise for a moment, then treats anything well above it as speech.
  private async detect() {
    const analyser = await this.meter();
    report("listen_start", { meter: Boolean(analyser), context: analysis?.state ?? "none", autoSend: this.autoSend });
    const started = Date.now();
    const samples = new Float32Array(1024);
    // The room's noise, taken as the quietest moment while the mic settles, so a tap or Ced talking
    // straight away doesn't raise it.
    let floor = Infinity;
    let loudMs = 0;
    let quietSince = 0;
    this.timer = setInterval(() => {
      const now = Date.now();
      if (!analyser) {
        // No level meter: fall back to tap to send.
        this.spoke = true;
        return;
      }
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      const level = Math.sqrt(sum / samples.length);
      this.peak = Math.max(this.peak, level);
      // A meter that reads exactly nothing is dead (seen on iPhone right after the page loads): start a fresh one once.
      if (this.peak === 0 && now - started >= 1000 && !this.remetered) {
        this.remetered = true;
        if (this.timer) clearInterval(this.timer);
        void analysis?.close().catch(() => {});
        analysis = null;
        void this.detect();
        return;
      }
      if (now - started < 300) {
        floor = Math.min(floor, level);
        return;
      }
      this.threshold = Math.min(0.04, Math.max(0.015, floor * 3));
      if (level > this.threshold) {
        quietSince = 0;
        // Speech is choppy, so loud moments add up rather than having to be continuous.
        loudMs += TICK_MS;
        if (!this.spoke && loudMs >= MIN_SPEECH_MS) {
          this.spoke = true;
          this.onSpeech();
        }
      } else {
        quietSince ||= now;
        if (this.autoSend && this.spoke && now - quietSince >= SILENCE_MS) {
          this.how ||= "pause";
          this.stopRecording();
        }
      }
      if (!this.spoke && now - started >= this.waitMs) {
        // Something was heard, even if briefly: let transcription decide rather than throwing it away.
        if (loudMs > 0) {
          this.how ||= "timeout-heard";
          this.spoke = true;
          this.stopRecording();
        } else {
          this.how ||= "no-speech";
          this.cancel();
        }
      }
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
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string; code?: string };
  if (!res.ok) throw new VoiceError(data.error ?? "Couldn't make out what you said.", data.code);
  return data.text ?? "";
}
