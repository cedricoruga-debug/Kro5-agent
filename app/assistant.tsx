"use client";

import type Anthropic from "@anthropic-ai/sdk";
import { useEffect, useRef, useState } from "react";
import { isStale } from "@/lib/build";
import { ASSISTANT, CastStream, splitCast, stripCast, team } from "@/lib/team";
import { type Activity, Dashboard } from "./dashboard";
import { Face } from "./face";
import { KOKORO_TEAM, KOKORO_VOICES, kokoroCrashed, type KokoroState, startKokoro } from "./kokoro";
import { Office } from "./office";
import { TopSheet } from "./sheet";
import type { Voice } from "@/lib/voice";
import { MicTurn, preview, ServerSpeaker, setAudioSession, type SpeakerLike, transcribe, unlockAudio, VoiceError, whenVoiceFails } from "./voice";

// An error whose message is written for Ced. Anything else (a dropped connection, a page the server
// didn't mean to send) shows a plain sentence instead of the browser's own wording.
class ShownError extends Error {}

type Turn = {
  who: "you" | "kro5";
  text: string;
  links?: { label: string; url: string }[];
  steps?: string[];
  // A write KRO5 lined up and wants Ced's yes for; shown with Approve and Not now buttons.
  approval?: { action: string };
  // Screenshots KRO5 took for this reply, full size, to save.
  images?: { label: string; src: string }[];
};
type Status = "idle" | "listening" | "thinking" | "speaking";

// The Web Speech API isn't in TypeScript's DOM types everywhere, so keep the surface we use small.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: any) => void) | null;
};

// Safety net so a forgotten open mic doesn't run forever.
const MAX_LISTEN_MS = 2 * 60 * 1000;
// Hands-free: send after this much quiet once Ced has said something.
const SILENCE_MS = 1600;
// Hands-free: if Ced says nothing this long after KRO5 reopens the mic, the conversation ends.
const NO_REPLY_MS = 8000;
// Hands-free: words that end the conversation instead of reopening the mic.
const SIGN_OFF = /^(ok(ay)?[, ]*)?(thanks|thank you|that's all|that is all|stop|goodbye|bye|good night|all good)\b/i;
// With a voice service: how long KRO5 waits for Ced to start talking after a tap.
const FIRST_WORDS_MS = 20 * 1000;
const VOICE_KEY = "kro5.voice";
// Which voices speak: the hosted service, or Kokoro, the free voice that runs on this phone (see app/kokoro.ts).
const ENGINE_KEY = "kro5.engine";
const KOKORO_VOICE_KEY = "kro5.voice.kokoro";
type Engine = "hosted" | "kokoro";

// What KRO5 did lately, kept on this phone for the dashboard.
const ACTIVITY_KEY = "kro5.activity";
const MAX_ACTIVITY = 20;

function loadActivity(): Activity[] {
  try {
    return JSON.parse(localStorage.getItem(ACTIVITY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveActivity(activity: Activity[]) {
  try {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity));
  } catch {}
}

function createRecognition(): Recognition | null {
  const w = window as any;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? (new Ctor() as Recognition) : null;
}

// Joins one recognition session's results. iOS sometimes repeats the whole phrase so far as a new result,
// so a result that starts with the previous one replaces it instead of being appended.
function joinResults(results: any): string {
  const parts: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const text = String(results[i][0].transcript).trim();
    if (!text) continue;
    const last = parts[parts.length - 1];
    if (last && text.toLowerCase().startsWith(last.toLowerCase())) parts[parts.length - 1] = text;
    else parts.push(text);
  }
  return parts.join(" ");
}

// iOS only plays speech that started from a tap. Speaking a silent utterance during the tap unlocks later replies.
function unlockSpeech() {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(" ");
  utterance.volume = 0;
  window.speechSynthesis.speak(utterance);
}

// Prefer a downloaded high-quality voice: British first (it suits a Jarvis), then any English one.
function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const good = (v: SpeechSynthesisVoice) => /enhanced|premium/i.test(v.name);
  return (
    voices.find((v) => good(v) && v.lang === "en-GB") ??
    voices.find(good) ??
    voices.find((v) => v.name.startsWith("Daniel")) ??
    voices.find((v) => v.lang === "en-US" && v.localService)
  );
}

// Speaks a streaming reply a sentence at a time in the phone's built-in voice, so KRO5 starts talking
// before the whole answer is in. Used when no voice service is set up.
class Speaker implements SpeakerLike {
  private buffer = "";
  private who = "";
  private pending = 0;
  private ended = false;
  private stopped = false;
  private unsupported = false;
  // Safari can drop an unreferenced utterance and never fire onend.
  private live = new Set<SpeechSynthesisUtterance>();

  constructor(
    private onDone: () => void,
    private onSpeaker?: (who: string) => void,
  ) {
    if (!("speechSynthesis" in window)) this.stopped = this.unsupported = true;
    else {
      setAudioSession("playback");
      window.speechSynthesis.cancel();
    }
  }

  push(text: string, who = "") {
    if (this.stopped) return;
    if (who !== this.who) {
      this.say(this.buffer);
      this.buffer = "";
      this.who = who;
    }
    this.buffer += text;
    // Speak up to the last sentence end that's followed by a space; keep the rest for later.
    const match = this.buffer.match(/^[\s\S]*[.!?](?=\s)/);
    if (match) {
      this.say(match[0]);
      this.buffer = this.buffer.slice(match[0].length);
    }
  }

  end() {
    // No speech in this browser: the reply is "spoken" at once. Stopped (interrupted): Ced is already talking.
    if (this.unsupported) return this.onDone();
    if (this.stopped) return;
    this.say(this.buffer);
    this.buffer = "";
    this.ended = true;
    this.check();
  }

  stop() {
    this.stopped = true;
    this.live.clear();
    window.speechSynthesis?.cancel();
  }

  get speaking() {
    return this.pending > 0;
  }

  private say(text: string) {
    if (!text.trim()) return;
    const utterance = new SpeechSynthesisUtterance(text.trim());
    utterance.lang = "en-US";
    utterance.rate = 1.05;
    const voice = pickVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      this.live.delete(utterance);
      this.pending--;
      this.check();
    };
    const who = this.who;
    utterance.onstart = () => this.onSpeaker?.(who);
    utterance.onend = done;
    utterance.onerror = done;
    this.live.add(utterance);
    this.pending++;
    const synth = window.speechSynthesis;
    // Safari sometimes ignores a speak() that immediately follows cancel(), so the first one waits a moment.
    setTimeout(() => {
      if (this.stopped) return;
      synth.speak(utterance);
      synth.resume();
    }, this.live.size === 1 ? 100 : 0);
  }

  private check() {
    if (this.ended && this.pending === 0 && !this.stopped) {
      this.stopped = true;
      this.onDone();
    }
  }
}

function greeting(): string {
  const hour = Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila", hour: "numeric", hour12: false }));
  return hour < 5 ? "Working late, Ced." : hour < 12 ? "Good morning, Ced." : hour < 18 ? "Good afternoon, Ced." : "Good evening, Ced.";
}

const BRIEF_ME = "Brief me: what needs my attention right now?";
// What the Approve and Not now buttons say for Ced.
const APPROVE = "Yes, go ahead.";
const DECLINE = "No, leave it for now.";
// How many of this phone's recent conversations a new conversation starts with.
const RECENT_CHATS = 5;
const NEWS = "What's the news, outside and inside KRO5?";
// How long a teammate who took something on stays at their desk working on it.
const BUSY_MS = 90 * 1000;

// What Ced might call each person at the start of a message ("CFO, how's cash?", "Hey KRO5, …").
// Speech-to-text writes KRO5 in a few ways.
const CALL_NAMES: [string, string][] = (
  [
    ...["kro5", "kro 5", "kro five", "crow five", "crow 5", "cro five", "cro 5", "krofive"].map((n) => [n, ASSISTANT]),
    ...team.flatMap((t) => [
      [t.handle.toLowerCase(), t.handle],
      [t.name.toLowerCase(), t.handle],
    ]),
    ["cpo", "CTO"],
    ["counsel", "General Counsel"],
    ["lawyer", "General Counsel"],
    ["director", "Independent Director"],
    ["courts", "Courts Lead"],
    ["chief", "Chief of Staff"],
  ] as [string, string][]
).sort((a, b) => b[0].length - a[0].length);

// The person a message is addressed to, if it starts with someone's name.
function addressed(text: string): string | null {
  const t = text.toLowerCase().replace(/^(hey|hi|hello|ok|okay|so|and|yo)\b[\s,]*/, "").replace(/^@/, "");
  for (const [name, handle] of CALL_NAMES) {
    if (t.startsWith(name) && !/[a-z0-9]/.test(t.charAt(name.length))) return handle;
  }
  return null;
}

function kokoroLabel(k: KokoroState) {
  if (k.state === "ready") return "Kokoro is ready. Every voice now runs on this phone for free.";
  if (k.state === "failed") return `Kokoro couldn't load here (${k.error ?? "unknown error"}), so the usual voices are speaking.`;
  const share = Math.round((k.share ?? 0) * 100);
  return `Downloading Kokoro, about 90 MB, once${share ? ` (${share}%)` : ""}. The usual voices speak until it's ready.`;
}

export function Assistant() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [interim, setInterim] = useState("");
  const [typed, setTyped] = useState("");
  const [voiceOn, setVoiceOn] = useState(true);
  const [micSupported, setMicSupported] = useState(true);
  const [micError, setMicError] = useState("");
  // Who Ced is talking to in the office (the assistant unless they tapped or named a teammate), who is
  // talking right now, and teammates who just took on work.
  const [focus, setFocus] = useState(ASSISTANT);
  const [speakingWho, setSpeakingWho] = useState("");
  const [busy, setBusy] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [working, setWorking] = useState("");
  const [step, setStep] = useState("");
  // The hosted voice service's voices, or null when KRO5 uses the phone's own voice and speech recognition.
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [voiceId, setVoiceId] = useState("");
  const [engine, setEngine] = useState<Engine>("hosted");
  const [kokoroVoice, setKokoroVoice] = useState(KOKORO_VOICES[0].id);
  const [kokoro, setKokoro] = useState<KokoroState>({ state: "off" });
  // Refs mirror state that callbacks (speech ends, recognition events) read after a re-render.
  const voiceOnRef = useRef(true);
  const voicesRef = useRef<Voice[] | null>(null);
  const voiceIdRef = useRef("");
  const engineRef = useRef<Engine>("hosted");
  const kokoroVoiceRef = useRef(KOKORO_VOICES[0].id);
  const teamVoicesRef = useRef<Record<string, string>>({});
  const focusRef = useRef(ASSISTANT);
  const micTurn = useRef<MicTurn | null>(null);
  const speaker = useRef<SpeakerLike | null>(null);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const history = useRef<Anthropic.Beta.BetaMessageParam[]>([]);
  const recognition = useRef<Recognition | null>(null);
  // The mic stays open until Ced taps to send. iOS ends recognition on pauses, so it's restarted
  // and each finished session's words are kept in `heard`.
  const keepListening = useRef(false);
  const heard = useRef("");
  const sessionText = useRef("");
  const listenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const typedInput = useRef<HTMLInputElement>(null);
  // send() runs from mic callbacks made on earlier renders, so it reads the activity through a ref.
  const activityRef = useRef<Activity[]>([]);
  const wakeLock = useRef<any>(null);

  useEffect(() => setMicSupported(createRecognition() !== null), []);
  useEffect(() => setActivity(loadActivity()), []);
  useEffect(() => {
    activityRef.current = activity;
  }, [activity]);
  // If the voice service rejects its key, use the phone's own voice and recognition for the rest of the visit
  // and say why, instead of going quiet.
  function voiceProblem(error: VoiceError) {
    if (error.code === "voice_key") {
      voicesRef.current = null;
      setVoices(null);
      setMicSupported(createRecognition() !== null);
      setMicError(`${error.message} Using the phone's own voice for now.`);
    } else setMicError(error.message);
  }
  useEffect(() => whenVoiceFails(voiceProblem), []);
  useEffect(() => {
    fetch("/api/voice", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { provider: string | null; voices: Voice[]; teamVoices?: Record<string, string> } | null) => {
        teamVoicesRef.current = data?.teamVoices ?? {};
        if (!data?.provider || !data.voices.length || !navigator.mediaDevices || typeof MediaRecorder === "undefined") return;
        let saved = "";
        try {
          saved = localStorage.getItem(VOICE_KEY) ?? "";
        } catch {}
        const id = data.voices.some((v) => v.id === saved) ? saved : data.voices[0].id;
        voicesRef.current = data.voices;
        voiceIdRef.current = id;
        setVoices(data.voices);
        setVoiceId(id);
        setMicSupported(true);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    voiceOnRef.current = voiceOn;
  }, [voiceOn]);
  useEffect(() => {
    let saved = "";
    let savedVoice = "";
    try {
      saved = localStorage.getItem(ENGINE_KEY) ?? "";
      savedVoice = localStorage.getItem(KOKORO_VOICE_KEY) ?? "";
    } catch {}
    if (KOKORO_VOICES.some((v) => v.id === savedVoice)) {
      kokoroVoiceRef.current = savedVoice;
      setKokoroVoice(savedVoice);
    }
    if (saved !== "kokoro") return;
    if (kokoroCrashed()) {
      chooseEngine("hosted");
      setMicError("Kokoro needed more memory than this phone gives a web page and closed the app, so KRO5 is back on ElevenLabs.");
    } else chooseEngine("kokoro", false);
  }, []);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), [turns, interim, showLog]);
  // Voices load asynchronously; asking early makes them ready by the first reply.
  useEffect(() => void window.speechSynthesis?.getVoices(), []);
  // Keep the screen on while KRO5 is open, so the phone doesn't lock mid-conversation.
  // The lock drops whenever the app is hidden, so it's taken again when KRO5 comes back.
  useEffect(() => {
    void keepAwake();
    const onVisible = () => {
      if (document.visibilityState === "visible") void keepAwake();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void wakeLock.current?.release();
    };
  }, []);

  async function keepAwake() {
    try {
      if (wakeLock.current && !wakeLock.current.released) return;
      wakeLock.current = (await (navigator as any).wakeLock?.request("screen")) ?? null;
    } catch {}
  }

  // KRO5 is always hands-free: after a reply it opens the mic again, like carrying on a conversation.
  function afterReply(signedOff: boolean) {
    if (voiceOnRef.current && !signedOff) listen({ autoReopened: true });
    else setStatus("idle");
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return setStatus("idle");
    const signedOff = SIGN_OFF.test(trimmed);
    const named = addressed(trimmed);
    if (named) changeFocus(named);
    const talkingTo = focusRef.current === ASSISTANT ? undefined : focusRef.current;
    setTurns((t) => [...t, { who: "you", text: trimmed }, { who: "kro5", text: "" }]);
    setWorking(trimmed);
    setStep("");
    setStatus("thinking");
    // The reply bubble added above fills in as the answer streams.
    const update = (change: Partial<Turn>) =>
      setTurns((t) => [...t.slice(0, -1), { ...t[t.length - 1], ...change }]);
    // Teammates who speak in this reply go back to their desks to work on it afterwards.
    const spoke = new Set<string>();
    const onSpeaker = (who: string) => {
      const w = who || ASSISTANT;
      setSpeakingWho(w);
      if (w !== ASSISTANT) spoke.add(w);
    };
    const onSpoken = () => {
      setSpeakingWho("");
      markBusy(spoke);
      afterReply(signedOff);
    };
    const hostedFor = (who: string) => (who !== ASSISTANT && teamVoicesRef.current[who]) || voiceIdRef.current;
    const kokoroFor = (who: string) => (who !== ASSISTANT && KOKORO_TEAM[who]) || kokoroVoiceRef.current;
    const voice = !voiceOnRef.current
      ? null
      : engineRef.current === "kokoro"
        ? new ServerSpeaker(kokoroFor, onSpoken, onSpeaker, voicesRef.current ? hostedFor : undefined)
        : voicesRef.current
          ? new ServerSpeaker(hostedFor, onSpoken, onSpeaker)
          : new Speaker(onSpoken, onSpeaker);
    speaker.current = voice;
    const cast = new CastStream();
    let spoken = "";
    const messages = [...history.current, { role: "user" as const, content: trimmed }];
    // A new conversation carries the last few from this phone, so KRO5 remembers what was said on other days.
    const recent =
      messages.length === 1 ? activityRef.current.slice(0, RECENT_CHATS).map(({ at, asked, reply }) => ({ at, asked, reply: reply.slice(0, 300) })) : undefined;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, recent, talkingTo }),
      });
      if (res.status === 401) return window.location.reload();
      if (isStale(res)) {
        void res.body?.cancel();
        setTimeout(() => window.location.reload(), 2000);
        throw new ShownError("KRO5 was just updated. Reloading now, then ask me again.");
      }
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new ShownError(data?.error ?? `KRO5 couldn't answer (error ${res.status}). Try again.`);
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let pending = "";
      let result: any = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += value;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "text") {
            spoken += event.text;
            update({ text: spoken });
            for (const part of cast.feed(event.text)) {
              if (!voice) onSpeaker(part.who);
              else if (speaker.current === voice) {
                if (!voice.speaking) setStatus("speaking");
                voice.push(part.text, part.who);
              }
            }
          } else if (event.type === "step") setStep(event.step);
          else if (event.type === "error") throw new ShownError(event.error);
          else if (event.type === "done") result = event;
        }
      }
      if (!result) throw new ShownError("KRO5 lost the connection. Try again.");

      history.current = result.messages;
      update({ text: result.reply, links: result.links, steps: result.steps, approval: result.approval, images: result.images });
      setActivity((list) => {
        const entry = { at: new Date().toISOString(), asked: trimmed, reply: stripCast(result.reply), steps: result.steps ?? [], links: result.links ?? [] };
        const next = [entry, ...list].slice(0, MAX_ACTIVITY);
        saveActivity(next);
        return next;
      });
      if (voice) {
        // Interrupted mid-reply: Ced is already talking again, so leave the mic alone.
        if (speaker.current !== voice) return;
        for (const part of cast.end()) voice.push(part.text, part.who);
        // Replies that didn't stream (a refusal, too many steps) are spoken whole.
        if (!spoken) for (const part of splitCast(result.reply)) voice.push(part.text, part.who);
        setStatus("speaking");
        voice.end();
      } else {
        setSpeakingWho("");
        markBusy(spoke);
        afterReply(signedOff);
      }
    } catch (err) {
      if (!(err instanceof ShownError)) console.error(err);
      update({ text: err instanceof ShownError ? err.message : "Something went wrong talking to KRO5. Try again." });
      if (voice && speaker.current !== voice) return;
      setSpeakingWho("");
      voice?.stop();
      setStatus("idle");
    } finally {
      setWorking("");
      setStep("");
    }
  }

  function showHeard() {
    setInterim([heard.current, sessionText.current].filter(Boolean).join(" "));
  }

  function startSession() {
    const rec = createRecognition();
    if (!rec) {
      keepListening.current = false;
      setMicSupported(false);
      setStatus("idle");
      return;
    }
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    sessionText.current = "";
    rec.onresult = (event) => {
      sessionText.current = joinResults(event.results);
      showHeard();
      // Hands-free: a pause after speaking means Ced is done, so send it.
      if (sessionText.current) waitForSilence(SILENCE_MS);
    };
    rec.onerror = (event) => {
      // "no-speech" and "aborted" just end the session; it restarts below while Ced is still talking.
      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
        keepListening.current = false;
        setMicError("Microphone access is off. Allow it in Settings → Safari → Microphone, then try again.");
      }
    };
    rec.onend = () => {
      if (recognition.current !== rec) return;
      heard.current = [heard.current, sessionText.current].filter(Boolean).join(" ");
      sessionText.current = "";
      if (keepListening.current) {
        try {
          startSession();
          return;
        } catch {}
      }
      finishListening();
    };
    recognition.current = rec;
    rec.start();
  }

  function waitForSilence(ms: number) {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = setTimeout(stopListening, ms);
  }

  function finishListening() {
    if (listenTimer.current) clearTimeout(listenTimer.current);
    listenTimer.current = null;
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = null;
    keepListening.current = false;
    recognition.current = null;
    const text = heard.current;
    heard.current = "";
    setInterim("");
    void send(text);
  }

  function stopListening() {
    keepListening.current = false;
    const rec = recognition.current;
    if (!rec) return finishListening();
    rec.stop();
    // If Safari never reports the end, send what was heard anyway.
    setTimeout(() => {
      if (recognition.current === rec) {
        recognition.current = null;
        heard.current = [heard.current, sessionText.current].filter(Boolean).join(" ");
        sessionText.current = "";
        finishListening();
      }
    }, 1500);
  }

  // With a voice service: record Ced's turn and transcribe it. The mic reopens without a tap on iPhone.
  async function listenAndTranscribe(autoReopened: boolean) {
    setMicError("");
    setInterim("");
    setStatus("listening");
    const turn = new MicTurn(autoReopened ? NO_REPLY_MS : FIRST_WORDS_MS, true, () => setInterim("…"));
    micTurn.current = turn;
    let heardAudio;
    try {
      heardAudio = await turn.start();
    } catch {
      if (micTurn.current === turn) micTurn.current = null;
      setMicError("Microphone access is off. Allow it in Settings → Safari → Microphone, then try again.");
      return setStatus("idle");
    }
    // Reset or a new turn took over while this one was recording.
    if (micTurn.current !== turn) return;
    micTurn.current = null;
    setInterim("");
    if (!heardAudio) return setStatus("idle");
    setStatus("thinking");
    setStep("Listening back");
    try {
      const text = await transcribe(heardAudio);
      if (!text) {
        setMicError("I didn't catch that. Tap and try again.");
        return setStatus("idle");
      }
      void send(text);
    } catch (err) {
      if (err instanceof VoiceError && err.code === "voice_key") voiceProblem(err);
      else setMicError(err instanceof Error ? err.message : "Couldn't make out what you said.");
      setStatus("idle");
    }
  }

  function listen({ autoReopened = false } = {}) {
    if (voicesRef.current) return void listenAndTranscribe(autoReopened);
    setAudioSession("auto");
    setMicError("");
    heard.current = "";
    keepListening.current = true;
    setStatus("listening");
    listenTimer.current = setTimeout(stopListening, MAX_LISTEN_MS);
    // If Ced doesn't answer a reopened mic, the conversation quietly ends.
    if (autoReopened) waitForSilence(NO_REPLY_MS);
    try {
      startSession();
    } catch {
      // iOS may refuse to reopen the mic without a tap; fall back to tap to talk.
      keepListening.current = false;
      recognition.current = null;
      if (listenTimer.current) clearTimeout(listenTimer.current);
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      setStatus("idle");
    }
  }

  // Call during a tap: iPhone only plays sound that a tap unlocked first.
  function unlock() {
    if (!voiceOn) return;
    unlockSpeech();
    unlockAudio();
  }

  function toggleMic() {
    void keepAwake();
    if (status === "speaking") {
      // Interrupt: stop talking and listen straight away.
      speaker.current?.stop();
      speaker.current = null;
      setSpeakingWho("");
      unlock();
      listen();
      return;
    }
    if (status === "listening") {
      // This tap also unlocks speech for the reply.
      unlock();
      if (micTurn.current) micTurn.current.send();
      else stopListening();
      return;
    }
    if (status !== "idle") return;

    unlock();
    listen();
  }

  function chooseVoice(id: string) {
    if (engineRef.current === "kokoro") {
      kokoroVoiceRef.current = id;
      setKokoroVoice(id);
    } else {
      voiceIdRef.current = id;
      setVoiceId(id);
    }
    try {
      localStorage.setItem(engineRef.current === "kokoro" ? KOKORO_VOICE_KEY : VOICE_KEY, id);
    } catch {}
    const name = [...(voices ?? []), ...KOKORO_VOICES].find((v) => v.id === id)?.name ?? "your new voice";
    if (status === "idle") preview(id, `Hello Ced, ${name} here. How does this sound?`, voicesRef.current ? voiceIdRef.current : undefined);
  }

  // Kokoro downloads its model the first time it's picked; the hosted voice speaks until it's ready.
  function chooseEngine(next: Engine, save = true) {
    engineRef.current = next;
    setEngine(next);
    if (save) {
      try {
        localStorage.setItem(ENGINE_KEY, next);
      } catch {}
    }
    if (next === "kokoro") startKokoro(setKokoro);
  }

  // Approve or Not now on a lined-up action. Stops KRO5 speaking or listening first, like a tap would.
  function answerApproval(text: string) {
    setTurns((t) => t.map((turn) => (turn.approval ? { ...turn, approval: undefined } : turn)));
    if (status !== "idle") {
      speaker.current?.stop();
      speaker.current = null;
      setSpeakingWho("");
      const turn = micTurn.current;
      micTurn.current = null;
      turn?.cancel();
      keepListening.current = false;
      const rec = recognition.current;
      recognition.current = null;
      rec?.stop();
      setInterim("");
      setStatus("idle");
    }
    unlock();
    void send(text);
  }

  function changeFocus(handle: string) {
    focusRef.current = handle;
    setFocus(handle);
  }

  function markBusy(handles: Set<string>) {
    if (!handles.size) return;
    setBusy((list) => [...new Set([...list, ...handles])]);
    setTimeout(() => setBusy((list) => list.filter((h) => !handles.has(h))), BUSY_MS);
  }

  // Tapping someone in the office (or on the dashboard) talks to them: KRO5 stops, and the mic opens.
  function talkTo(handle: string) {
    changeFocus(handle);
    setSheetOpen(false);
    if (status === "thinking") return;
    void keepAwake();
    if (status === "speaking") {
      speaker.current?.stop();
      speaker.current = null;
      setSpeakingWho("");
      unlock();
      listen();
    } else if (status === "idle") {
      unlock();
      listen();
    }
  }

  function ask(text: string) {
    if (status !== "idle") return;
    void keepAwake();
    unlock();
    void send(text);
  }

  function submitTyped(event: React.FormEvent) {
    event.preventDefault();
    if (status !== "idle") return;
    unlock();
    const text = typed;
    setTyped("");
    setTyping(false);
    void send(text);
  }

  function reset() {
    speaker.current?.stop();
    speaker.current = null;
    const turn = micTurn.current;
    micTurn.current = null;
    turn?.cancel();
    keepListening.current = false;
    if (listenTimer.current) clearTimeout(listenTimer.current);
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    const rec = recognition.current;
    recognition.current = null;
    rec?.stop();
    heard.current = "";
    sessionText.current = "";
    setInterim("");
    history.current = [];
    setTurns([]);
    setStatus("idle");
    setSpeakingWho("");
    changeFocus(ASSISTANT);
    setShowLog(false);
  }

  const focusName = focus === ASSISTANT ? "KRO5" : (team.find((t) => t.handle === focus)?.name ?? focus);
  const label = {
    idle: focus === ASSISTANT ? "Tap the mic, or tap someone to talk to them" : `With ${focusName} · tap the mic to talk`,
    listening: `${focusName} is listening · I'll send when you pause`,
    thinking: step ? `${step}…` : `${focusName} is thinking…`,
    speaking: "Tap the mic to interrupt",
  }[status];
  const live = {
    idle: "Idle",
    listening: "Listening to you",
    thinking: working ? `${step || "Working"} on “${working.slice(0, 60)}${working.length > 60 ? "…" : ""}”` : "Thinking",
    speaking: "Speaking",
  }[status];
  // The assistant's screen on the wall reacts when she's the one in the conversation.
  const faceStatus =
    status === "speaking" ? (speakingWho === ASSISTANT ? "speaking" : "idle") : focus === ASSISTANT || status === "thinking" ? status : "idle";
  const last = turns[turns.length - 1];
  const lastAsk = [...turns].reverse().find((t) => t.who === "you");

  function reply(turn: Turn, latest: boolean) {
    return (
      <>
        {splitCast(turn.text).map((part, k) => (
          <p key={k} className={`line ${latest && part.who === speakingWho ? "now" : ""}`}>
            <b>{part.who === ASSISTANT ? "KRO5" : (team.find((t) => t.handle === part.who)?.name ?? part.who)}</b> {part.text}
          </p>
        ))}
        {turn.steps && turn.steps.length > 0 && <p className="steps">{turn.steps.join(" · ")}</p>}
        {turn.links && turn.links.length > 0 && (
          <div className="links">
            {turn.links.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ))}
          </div>
        )}
        {turn.images && turn.images.length > 0 && (
          <div className="shots">
            {turn.images.map((image) => (
              // Tapping downloads the picture full size; on iPhone, press and hold it to save to Photos.
              <a key={image.src.slice(-32)} href={image.src} download={`${image.label.replace(/[^a-z0-9]+/gi, "-")}.jpg`}>
                <img src={image.src} alt={`Screenshot of ${image.label}`} />
                <span>{image.label}</span>
              </a>
            ))}
          </div>
        )}
        {turn.approval && latest && (
          <div className="approval">
            <p>{turn.approval.action}</p>
            <div>
              <button onClick={() => answerApproval(APPROVE)} disabled={status === "thinking"}>
                Approve
              </button>
              <button className="ghost" onClick={() => answerApproval(DECLINE)} disabled={status === "thinking"}>
                Not now
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <main className="assistant">
      <TopSheet open={sheetOpen} onOpen={setSheetOpen}>
        <Dashboard
          live={live}
          activity={activity}
          onAskTeam={talkTo}
          settings={
            <div className="settings">
              <button className="ghost small" onClick={() => setVoiceOn((v) => !v)} aria-pressed={voiceOn}>
                {voiceOn ? "Voice on" : "Voice off"}
              </button>
              {voiceOn && (
                <label className="voice-pick">
                  Voices
                  <select value={engine} onChange={(e) => chooseEngine(e.target.value as Engine)}>
                    <option value="hosted">{voices ? "ElevenLabs" : "Phone's own voice"}</option>
                    <option value="kokoro">Kokoro (free, on this phone)</option>
                  </select>
                </label>
              )}
              {voiceOn && engine === "kokoro" && <p className="kokoro-state">{kokoroLabel(kokoro)}</p>}
              {voiceOn && (engine === "kokoro" || voices) && (
                <label className="voice-pick">
                  KRO5's voice
                  <select value={engine === "kokoro" ? kokoroVoice : voiceId} onChange={(e) => chooseVoice(e.target.value)}>
                    {(engine === "kokoro" ? KOKORO_VOICES : (voices ?? [])).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.about})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button className="ghost small" onClick={reset}>
                New conversation
              </button>
            </div>
          }
        />
      </TopSheet>

      <Office
        speaking={speakingWho}
        focus={focus}
        status={status}
        busy={busy}
        face={<Face status={faceStatus} onTap={() => talkTo(ASSISTANT)} />}
        onTap={talkTo}
      />

      <section className="dialogue" aria-live="polite">
        <p className={`caption ${micError ? "error" : ""}`}>{micError || label}</p>
        {turns.length === 0 && !interim ? (
          <>
            <p className="line">
              <b>KRO5</b> {greeting()} I'm at the front desk and the team's around. Ask me anything, or tap someone to talk to them.
            </p>
            <div className="quick">
              <button className="brief" onClick={() => ask(BRIEF_ME)} disabled={status !== "idle"}>
                Brief me
              </button>
              <button className="brief" onClick={() => ask(NEWS)} disabled={status !== "idle"}>
                News
              </button>
            </div>
          </>
        ) : (
          <div className="lines">
            {lastAsk && (
              <p className="line you">
                <b>You</b> {lastAsk.text}
              </p>
            )}
            {last?.who === "kro5" && reply(last, true)}
            {interim && (
              <p className="line you interim">
                <b>You</b> {interim}
              </p>
            )}
            <div ref={showLog ? undefined : bottom} />
          </div>
        )}
      </section>

      {typing && (
        <form onSubmit={submitTyped} className="typed">
          <input ref={typedInput} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Message ${focusName}`} autoFocus />
          <button type="submit" disabled={!typed.trim() || status !== "idle"} aria-label="Send">
            <Icon name="send" />
          </button>
        </form>
      )}

      <nav className="bar">
        <button className={`icon ${typing ? "on" : ""}`} onClick={() => setTyping((t) => !t)} aria-label="Type a message" aria-pressed={typing}>
          <Icon name="keyboard" />
        </button>
        {micSupported ? (
          <button className={`mic ${status}`} onClick={toggleMic} disabled={status === "thinking"} aria-label={label}>
            <Icon name={status === "speaking" ? "stop" : "mic"} />
          </button>
        ) : (
          <button className="mic" disabled aria-label="Voice input isn't available in this browser">
            <Icon name="mic" />
          </button>
        )}
        <button className={`icon ${showLog ? "on" : ""}`} onClick={() => setShowLog((v) => !v)} aria-label="Conversation so far" aria-pressed={showLog}>
          <Icon name="chat" />
        </button>
      </nav>

      {showLog && (
        <div className="log" role="dialog" aria-label="Conversation so far">
          <div className="log-head">
            <strong>Conversation</strong>
            <button className="ghost small" onClick={reset}>
              New
            </button>
            <button className="ghost small" onClick={() => setShowLog(false)}>
              Close
            </button>
          </div>
          <div className="log-body">
            {turns.length === 0 && <p className="note center">Nothing said yet.</p>}
            {turns.map((turn, i) =>
              turn.who === "you" ? (
                <div key={i} className="bubble you">
                  <p>{turn.text}</p>
                </div>
              ) : turn.text || turn.links ? (
                <div key={i} className="bubble kro5">
                  {reply(turn, i === turns.length - 1)}
                </div>
              ) : null,
            )}
            <div ref={showLog ? bottom : undefined} />
          </div>
        </div>
      )}
    </main>
  );
}

// Line icons for the bottom bar.
function Icon({ name }: { name: "mic" | "keyboard" | "chat" | "send" | "stop" }) {
  const paths = {
    mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
    keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
    chat: <path d="M4 5h16v11H9l-5 4z" />,
    send: <path d="M4 12l16-8-6 16-2-6z" />,
    stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  }[name];
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths}
    </svg>
  );
}
