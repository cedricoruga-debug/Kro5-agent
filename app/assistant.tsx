"use client";

import type Anthropic from "@anthropic-ai/sdk";
import { useEffect, useRef, useState } from "react";
import { type Activity, Dashboard } from "./dashboard";

type Turn = { who: "you" | "kro5"; text: string; links?: { label: string; url: string }[]; steps?: string[] };
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
const HANDS_FREE_KEY = "kro5.handsFree";

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

// Safari 17+: route web audio as media playback so replies aren't muted by the silent switch.
function setAudioSession(type: "auto" | "playback") {
  try {
    const session = (navigator as any).audioSession;
    if (session) session.type = type;
  } catch {}
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

// Speaks a streaming reply a sentence at a time, so KRO5 starts talking before the whole answer is in.
class Speaker {
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
  const [handsFree, setHandsFree] = useState(false);
  // Refs mirror state that callbacks (speech ends, recognition events) read after a re-render.
  const handsFreeRef = useRef(false);
  const voiceOnRef = useRef(true);
  const speaker = useRef<Speaker | null>(null);
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
  const wakeLock = useRef<any>(null);

  useEffect(() => setMicSupported(createRecognition() !== null), []);
  useEffect(() => setActivity(loadActivity()), []);
  useEffect(() => {
    try {
      const on = localStorage.getItem(HANDS_FREE_KEY) === "1";
      handsFreeRef.current = on;
      setHandsFree(on);
    } catch {}
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

  function toggleHandsFree() {
    const on = !handsFreeRef.current;
    handsFreeRef.current = on;
    setHandsFree(on);
    try {
      localStorage.setItem(HANDS_FREE_KEY, on ? "1" : "0");
    } catch {}
  }

  // After a reply, hands-free mode opens the mic again, like carrying on a conversation.
  function afterReply(signedOff: boolean) {
    if (handsFreeRef.current && voiceOnRef.current && !signedOff) listen({ autoReopened: true });
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
    const voice = voiceOnRef.current ? new Speaker(() => afterReply(signedOff)) : null;
    speaker.current = voice;
    let spoken = "";
    const messages = [...history.current, { role: "user" as const, content: trimmed }];
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      if (res.status === 401) return window.location.reload();
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? "Something went wrong.");

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
          else if (event.type === "error") throw new Error(event.error);
          else if (event.type === "done") result = event;
        }
      }
      if (!result) throw new Error("KRO5 lost the connection. Try again.");

      history.current = result.messages;
      update({ text: result.reply, links: result.links, steps: result.steps });
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
      update({ text: err instanceof Error ? err.message : "Something went wrong." });
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
      if (handsFreeRef.current && sessionText.current) waitForSilence(SILENCE_MS);
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

  function listen({ autoReopened = false } = {}) {
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

  function toggleMic() {
    void keepAwake();
    if (status === "speaking") {
      // Interrupt: stop talking and listen straight away.
      speaker.current?.stop();
      speaker.current = null;
      if (voiceOn) unlockSpeech();
      listen();
      return;
    }
    if (status === "listening") {
      // This tap also unlocks speech for the reply.
      if (voiceOn) unlockSpeech();
      stopListening();
      return;
    }
    if (status !== "idle") return;

    if (voiceOn) unlockSpeech();
    listen();
  }

  function briefMe() {
    if (status !== "idle") return;
    void keepAwake();
    if (voiceOn) unlockSpeech();
    void send(BRIEF_ME);
  }

  function submitTyped(event: React.FormEvent) {
    event.preventDefault();
    if (status !== "idle") return;
    if (voiceOn) unlockSpeech();
    const text = typed;
    setTyped("");
    void send(text);
  }

  function reset() {
    speaker.current?.stop();
    speaker.current = null;
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
    listening: handsFree ? "Listening… I'll send when you pause" : "Listening… tap to send",
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
          <button className="ghost" onClick={toggleHandsFree} aria-pressed={handsFree}>
            {handsFree ? "Hands-free" : "Tap mode"}
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
          <Dashboard live={live} activity={activity} />
        </section>
      ) : (
      <section className="transcript">
        {turns.length === 0 && (
          <>
          <p className="greeting">{greeting()}</p>
          <button className="brief" onClick={briefMe} disabled={status !== "idle"}>
            Brief me
          </button>
          <p className="hint">Try “Did the last deploy work?”, “How many new leads came in this week?”, or “Ask the CFO if the founding rate still works.”
            {handsFree && " Hands-free is on: after I answer I'll listen again, and “thanks, that's all” ends it."}
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
        <form onSubmit={submitTyped} className="typed">
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type a message" />
          <button type="submit" disabled={!typed.trim() || status !== "idle"}>
            Send
          </button>
        </form>
      </footer>
    </main>
  );
}
