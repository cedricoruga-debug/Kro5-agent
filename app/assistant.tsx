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

function createRecognition(): Recognition | null {
  const w = window as any;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? (new Ctor() as Recognition) : null;
}

function speak(text: string, onDone: () => void) {
  if (!("speechSynthesis" in window)) return onDone();
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.05;
  utterance.onend = onDone;
  utterance.onerror = onDone;
  window.speechSynthesis.speak(utterance);
}

export function Assistant() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [interim, setInterim] = useState("");
  const [typed, setTyped] = useState("");
  const [voiceOn, setVoiceOn] = useState(true);
  const [micSupported, setMicSupported] = useState(true);
  const history = useRef<Anthropic.Beta.BetaMessageParam[]>([]);
  const recognition = useRef<Recognition | null>(null);
  const finalText = useRef("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => setMicSupported(createRecognition() !== null), []);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [turns, interim]);

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

  function toggleMic() {
    if (status === "speaking") {
      window.speechSynthesis.cancel();
      setStatus("idle");
      return;
    }
    if (status === "listening") {
      recognition.current?.stop();
      return;
    }
    if (status !== "idle") return;

    // iOS only lets speech play after a user gesture, so unlock it on this tap.
    if (voiceOn && "speechSynthesis" in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));

    const rec = createRecognition();
    if (!rec) return setMicSupported(false);
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    finalText.current = "";
    rec.onresult = (event) => {
      let heard = "";
      for (let i = 0; i < event.results.length; i++) heard += event.results[i][0].transcript;
      finalText.current = heard;
      setInterim(heard);
    };
    rec.onerror = () => setInterim("");
    rec.onend = () => {
      setInterim("");
      void send(finalText.current);
    };
    recognition.current = rec;
    setStatus("listening");
    rec.start();
  }

  function submitTyped(event: React.FormEvent) {
    event.preventDefault();
    if (status !== "idle") return;
    const text = typed;
    setTyped("");
    void send(text);
  }

  function reset() {
    window.speechSynthesis?.cancel();
    recognition.current?.stop();
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
        <p className="status">{micSupported ? label : ""}</p>
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
