"use client";

import type Anthropic from "@anthropic-ai/sdk";
import { useEffect, useRef, useState } from "react";
import { isStale } from "@/lib/build";
import { type Activity, Dashboard } from "./dashboard";
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
  private pending = 0;
  private ended = false;
  private stopped = false;
  private unsupported = false;
  // Safari can drop an unreferenced utterance and never fire onend.
  private live = new Set<SpeechSynthesisUtterance>();

  constructor(private onDone: () => void) {
    if (!("speechSynthesis" in window)) this.stopped = this.unsupported = true;
    else {
      setAudioSession("playback");
      window.speechSynthesis.cancel();
    }
  }

  push(text: string) {
    if (this.stopped) return;
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

export function Assistant() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [interim, setInterim] = useState("");
  const [typed, setTyped] = useState("");
  const [voiceOn, setVoiceOn] = useState(true);
  const [micSupported, setMicSupported] = useState(true);
  const [micError, setMicError] = useState("");
  const [view, setView] = useState<"dashboard" | "chat">("dashboard");
  const [activity, setActivity] = useState<Activity[]>([]);
  const [working, setWorking] = useState("");
  const [step, setStep] = useState("");
  // The hosted voice service's voices, or null when KRO5 uses the phone's own voice and speech recognition.
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [voiceId, setVoiceId] = useState("");
  // Refs mirror state that callbacks (speech ends, recognition events) read after a re-render.
  const voiceOnRef = useRef(true);
  const voicesRef = useRef<Voice[] | null>(null);
  const voiceIdRef = useRef("");
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
      .then((data: { provider: string | null; voices: Voice[] } | null) => {
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
  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [turns, interim]);
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
    setTurns((t) => [...t, { who: "you", text: trimmed }, { who: "kro5", text: "" }]);
    setView("chat");
    setWorking(trimmed);
    setStep("");
    setStatus("thinking");
    // The reply bubble added above fills in as the answer streams.
    const update = (change: Partial<Turn>) =>
      setTurns((t) => [...t.slice(0, -1), { ...t[t.length - 1], ...change }]);
    const onSpoken = () => afterReply(signedOff);
    const voice = !voiceOnRef.current ? null : voicesRef.current ? new ServerSpeaker(voiceIdRef.current, onSpoken) : new Speaker(onSpoken);
    speaker.current = voice;
    let spoken = "";
    const messages = [...history.current, { role: "user" as const, content: trimmed }];
    // A new conversation carries the last few from this phone, so KRO5 remembers what was said on other days.
    const recent =
      messages.length === 1 ? activityRef.current.slice(0, RECENT_CHATS).map(({ at, asked, reply }) => ({ at, asked, reply: reply.slice(0, 300) })) : undefined;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, recent }),
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
            if (voice && speaker.current === voice) {
              if (!voice.speaking) setStatus("speaking");
              voice.push(event.text);
            }
          } else if (event.type === "step") setStep(event.step);
          else if (event.type === "error") throw new ShownError(event.error);
          else if (event.type === "done") result = event;
        }
      }
      if (!result) throw new ShownError("KRO5 lost the connection. Try again.");

      history.current = result.messages;
      update({ text: result.reply, links: result.links, steps: result.steps, approval: result.approval });
      setActivity((list) => {
        const entry = { at: new Date().toISOString(), asked: trimmed, reply: result.reply, steps: result.steps ?? [], links: result.links ?? [] };
        const next = [entry, ...list].slice(0, MAX_ACTIVITY);
        saveActivity(next);
        return next;
      });
      if (voice) {
        // Interrupted mid-reply: Ced is already talking again, so leave the mic alone.
        if (speaker.current !== voice) return;
        // Replies that didn't stream (a refusal, too many steps) are spoken whole.
        if (!spoken) voice.push(result.reply);
        setStatus("speaking");
        voice.end();
      } else afterReply(signedOff);
    } catch (err) {
      if (!(err instanceof ShownError)) console.error(err);
      update({ text: err instanceof ShownError ? err.message : "Something went wrong talking to KRO5. Try again." });
      if (voice && speaker.current !== voice) return;
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
    setView("chat");
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
    setView("chat");
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
    voiceIdRef.current = id;
    setVoiceId(id);
    try {
      localStorage.setItem(VOICE_KEY, id);
    } catch {}
    const name = voices?.find((v) => v.id === id)?.name ?? "your new voice";
    if (status === "idle") preview(id, `Hello Ced, ${name} here. How does this sound?`);
  }

  // Approve or Not now on a lined-up action. Stops KRO5 speaking or listening first, like a tap would.
  function answerApproval(text: string) {
    setTurns((t) => t.map((turn) => (turn.approval ? { ...turn, approval: undefined } : turn)));
    if (status !== "idle") {
      speaker.current?.stop();
      speaker.current = null;
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

  // Tapping a teammate on the dashboard starts a message to them for Ced to finish.
  function askTeammate(handle: string) {
    setView("chat");
    setTyped(`@${handle} `);
    setTimeout(() => typedInput.current?.focus(), 0);
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
    setView("dashboard");
  }

  const label = {
    idle: "Tap to talk",
    listening: "Listening… I'll send when you pause",
    thinking: step ? `${step}…` : "Thinking…",
    speaking: "Tap to interrupt",
  }[status];
  const live = {
    idle: "Idle",
    listening: "Listening to you",
    thinking: working ? `${step || "Working"} on “${working.slice(0, 60)}${working.length > 60 ? "…" : ""}”` : "Thinking",
    speaking: "Speaking",
  }[status];

  return (
    <main className="assistant">
      <header>
        <h1>KRO5</h1>
        <div className="header-actions">
          <button className="ghost" onClick={() => setView((v) => (v === "chat" ? "dashboard" : "chat"))}>
            {view === "chat" ? "Dashboard" : "Chat"}
          </button>
          <button className="ghost" onClick={() => setVoiceOn((v) => !v)} aria-pressed={voiceOn}>
            {voiceOn ? "Voice on" : "Voice off"}
          </button>
          <button className="ghost" onClick={reset}>
            New
          </button>
        </div>
      </header>

      {view === "dashboard" ? (
        <section className="transcript">
          <Dashboard live={live} activity={activity} onAskTeam={askTeammate} />
        </section>
      ) : (
      <section className="transcript">
        {turns.length === 0 && (
          <>
          <p className="greeting">{greeting()}</p>
          <div className="quick">
            <button className="brief" onClick={() => ask(BRIEF_ME)} disabled={status !== "idle"}>
              Brief me
            </button>
            <button className="brief" onClick={() => ask(NEWS)} disabled={status !== "idle"}>
              News
            </button>
          </div>
          <p className="hint">Try “Did the last deploy work?”, “Research what VA agencies pay for time tracking”, or “What should I focus on to land the next agency?”
            {" After I answer I'll listen again, and “thanks, that's all” ends it."}
          </p>
          </>
        )}
        {turns.map((turn, i) => (
          turn.text || turn.links ? (
          <div key={i} className={`bubble ${turn.who}`}>
            <p>{turn.text}</p>
            {turn.steps && turn.steps.length > 0 && <p className="steps">{turn.steps.join(" · ")}</p>}
            {turn.links?.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ))}
            {turn.approval && i === turns.length - 1 && (
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
          </div>
          ) : null
        ))}
        {interim && <div className="bubble you interim">{interim}</div>}
        <div ref={bottom} />
      </section>
      )}

      <footer>
        {micSupported ? (
          <button className={`mic ${status}`} onClick={toggleMic} disabled={status === "thinking"} aria-label={label}>
            <span className="dot" />
          </button>
        ) : (
          <p className="hint">Voice input isn't available in this browser. Type below instead.</p>
        )}
        <p className="status">{micError || (micSupported ? label : "")}</p>
        {voices && voiceOn && (
          <label className="voice-pick">
            Voice
            <select value={voiceId} onChange={(e) => chooseVoice(e.target.value)}>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.about})
                </option>
              ))}
            </select>
          </label>
        )}
        <form onSubmit={submitTyped} className="typed">
          <input ref={typedInput} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type a message" />
          <button type="submit" disabled={!typed.trim() || status !== "idle"}>
            Send
          </button>
        </form>
      </footer>
    </main>
  );
}
