"use client";

import type Anthropic from "@anthropic-ai/sdk";
import { useEffect, useRef, useState } from "react";

type Turn = { who: "you" | "kro5"; text: string; links?: { label: string; url: string }[] };
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

let currentUtterance: SpeechSynthesisUtterance | null = null;

function speak(text: string, onDone: () => void) {
  if (!("speechSynthesis" in window)) return onDone();
  const synth = window.speechSynthesis;
  setAudioSession("playback");
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 1.05;
  const voice = synth.getVoices().find((v) => v.lang === "en-US" && v.localService);
  if (voice) utterance.voice = voice;
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    currentUtterance = null;
    onDone();
  };
  utterance.onend = done;
  utterance.onerror = done;
  // Keep a reference: Safari can drop an unreferenced utterance and never fire onend.
  currentUtterance = utterance;
  // Safari sometimes ignores a speak() that immediately follows cancel().
  setTimeout(() => {
    synth.speak(utterance);
    synth.resume();
  }, 100);
}

export function Assistant() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [interim, setInterim] = useState("");
  const [typed, setTyped] = useState("");
  const [voiceOn, setVoiceOn] = useState(true);
  const [micSupported, setMicSupported] = useState(true);
  const [micError, setMicError] = useState("");
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

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return setStatus("idle");
    setTurns((t) => [...t, { who: "you", text: trimmed }]);
    setStatus("thinking");
    const messages = [...history.current, { role: "user" as const, content: trimmed }];
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      if (res.status === 401) return window.location.reload();
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      history.current = data.messages;
      setTurns((t) => [...t, { who: "kro5", text: data.reply, links: data.links }]);
      if (voiceOn) {
        setStatus("speaking");
        speak(data.reply, () => setStatus("idle"));
      } else setStatus("idle");
    } catch (err) {
      setTurns((t) => [...t, { who: "kro5", text: err instanceof Error ? err.message : "Something went wrong." }]);
      setStatus("idle");
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

  function finishListening() {
    if (listenTimer.current) clearTimeout(listenTimer.current);
    listenTimer.current = null;
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

  function toggleMic() {
    void keepAwake();
    if (status === "speaking") {
      window.speechSynthesis.cancel();
      setStatus("idle");
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
    setAudioSession("auto");
    setMicError("");
    heard.current = "";
    keepListening.current = true;
    setStatus("listening");
    listenTimer.current = setTimeout(stopListening, MAX_LISTEN_MS);
    startSession();
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
    window.speechSynthesis?.cancel();
    keepListening.current = false;
    if (listenTimer.current) clearTimeout(listenTimer.current);
    const rec = recognition.current;
    recognition.current = null;
    rec?.stop();
    heard.current = "";
    sessionText.current = "";
    setInterim("");
    history.current = [];
    setTurns([]);
    setStatus("idle");
  }

  const label = { idle: "Tap to talk", listening: "Listening… tap to send", thinking: "Thinking…", speaking: "Tap to stop" }[status];

  return (
    <main className="assistant">
      <header>
        <h1>KRO5</h1>
        <div className="header-actions">
          <button className="ghost" onClick={() => setVoiceOn((v) => !v)} aria-pressed={voiceOn}>
            {voiceOn ? "Voice on" : "Voice off"}
          </button>
          <button className="ghost" onClick={reset}>
            New
          </button>
        </div>
      </header>

      <section className="transcript">
        {turns.length === 0 && (
          <p className="hint">Try “Did the last deploy work?”, “How many new leads came in this week?”, or “Ask the CFO if the founding rate still works.”</p>
        )}
        {turns.map((turn, i) => (
          <div key={i} className={`bubble ${turn.who}`}>
            <p>{turn.text}</p>
            {turn.links?.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ))}
          </div>
        ))}
        {interim && <div className="bubble you interim">{interim}</div>}
        <div ref={bottom} />
      </section>

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
