"use client";

import { useEffect, useRef, useState } from "react";
import { ASSISTANT, team } from "@/lib/team";

// The office: Ced's assistant at the front desk and the team as blocky characters. Teammates work at their
// desks or wander off to do things; whoever is talking comes up front by the assistant's desk.

type Hair = "short" | "long" | "bun" | "spiky" | "grey" | "bald";
type Extra = "glasses" | "tie" | "headset" | "cap" | "headphones" | "beard" | "bowtie" | "sweatband" | "clipboard";
type Look = { skin: string; shirt: string; pants: string; hair: Hair; hairColor: string; extras: Extra[]; tag: string };

const LOOKS: Record<string, Look> = {
  [ASSISTANT]: { skin: "#f2c9a0", shirt: "#2bd4a4", pants: "#24324a", hair: "long", hairColor: "#2b1a12", extras: ["headset"], tag: "KRO5" },
  "Chief of Staff": { skin: "#d9a477", shirt: "#7a5cff", pants: "#2c2c3a", hair: "bun", hairColor: "#3a2416", extras: ["clipboard"], tag: "Chief of Staff" },
  CFO: { skin: "#f5cd30", shirt: "#e9eef6", pants: "#2d3b55", hair: "short", hairColor: "#4a3020", extras: ["glasses", "tie"], tag: "CFO" },
  CMO: { skin: "#c68a5e", shirt: "#ff5d8f", pants: "#3b2f5c", hair: "long", hairColor: "#c0562b", extras: ["cap"], tag: "CMO" },
  COO: { skin: "#8d5a3b", shirt: "#ff9f1c", pants: "#29435c", hair: "short", hairColor: "#111111", extras: ["clipboard"], tag: "COO" },
  CTO: { skin: "#f5cd30", shirt: "#3a3f4b", pants: "#1f6feb", hair: "spiky", hairColor: "#1b1b1b", extras: ["headphones"], tag: "CTO" },
  "General Counsel": { skin: "#e8b48a", shirt: "#1d2b4a", pants: "#1d2b4a", hair: "bun", hairColor: "#7a7a7a", extras: ["glasses", "bowtie"], tag: "Counsel" },
  "VA Lead": { skin: "#b9774f", shirt: "#4cc9f0", pants: "#3a3a3a", hair: "long", hairColor: "#1a1a1a", extras: ["headset"], tag: "VA Lead" },
  "Courts Lead": { skin: "#f5cd30", shirt: "#a3e635", pants: "#14532d", hair: "spiky", hairColor: "#6b3e1f", extras: ["sweatband"], tag: "Courts" },
  Chair: { skin: "#e0ac85", shirt: "#3b0d2e", pants: "#222222", hair: "grey", hairColor: "#c9c9c9", extras: ["tie"], tag: "Chair" },
  "Independent Director": { skin: "#a86b45", shirt: "#556b2f", pants: "#3b3b3b", hair: "bald", hairColor: "#333333", extras: ["beard", "glasses"], tag: "Director" },
};

type Point = { x: number; y: number };

// Where each teammate works. The board has no desks: they sit on the sofa when they're not wandering.
const HOME: Record<string, Point & { desk: boolean }> = {
  CTO: { x: 14, y: 45, desk: true },
  CFO: { x: 38, y: 45, desk: true },
  CMO: { x: 62, y: 45, desk: true },
  COO: { x: 86, y: 45, desk: true },
  "Chief of Staff": { x: 14, y: 61, desk: true },
  "VA Lead": { x: 38, y: 61, desk: true },
  "Courts Lead": { x: 62, y: 61, desk: true },
  "General Counsel": { x: 86, y: 61, desk: true },
  Chair: { x: 9, y: 82, desk: false },
  "Independent Director": { x: 20, y: 82, desk: false },
};
const FRONT_DESK = { x: 50, y: 84 };
// Where a teammate stands to talk with Ced, beside the assistant's desk.
const HUDDLE = [
  { x: 72, y: 88 },
  { x: 30, y: 89 },
];

type Spot = Point & { name: string; act: string; prop: string; sit?: boolean };
// Things to do when they're not working.
const SPOTS: Spot[] = [
  { name: "coffee", x: 92, y: 76, act: "sip", prop: "☕" },
  { name: "water", x: 79, y: 32, act: "sip", prop: "🥤" },
  { name: "board", x: 20, y: 32, act: "write", prop: "🖊️" },
  { name: "window", x: 68, y: 31, act: "look", prop: "" },
  { name: "plant", x: 5, y: 68, act: "water", prop: "🚿" },
  { name: "sofa-a", x: 9, y: 82, act: "phone", prop: "📱", sit: true },
  { name: "sofa-b", x: 20, y: 82, act: "read", prop: "📰", sit: true },
  { name: "stretch", x: 50, y: 53, act: "stretch", prop: "" },
  { name: "ball", x: 36, y: 72, act: "juggle", prop: "⚽" },
];

type Mode = "desk" | "walk" | "act" | "huddle";
type Mate = Point & {
  handle: string;
  mode: Mode;
  act: string;
  prop: string;
  sit: boolean;
  spot: string;
  until: number;
  moveMs: number;
  // What they do once they arrive.
  next?: { mode: Mode; act: string; prop: string; sit: boolean; spot: string; ms: number };
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);
// Further back looks smaller.
const scale = (y: number) => 0.6 + (y / 100) * 0.5;

function walkMs(from: Point, to: Point) {
  return Math.max(700, Math.hypot(from.x - to.x, (from.y - to.y) * 1.6) * 70);
}

function atDesk(handle: string): Point {
  const home = HOME[handle];
  // Just in front of the desk's back edge, so the desk hides their legs.
  return home.desk ? { x: home.x, y: home.y + 0.5 } : home;
}

export function Office({
  speaking,
  focus,
  status,
  busy,
  face,
  onTap,
}: {
  // Who is talking right now ("" when nobody is), who Ced is talking to, and the conversation state.
  speaking: string;
  focus: string;
  status: "idle" | "listening" | "thinking" | "speaking";
  // Teammates who just took on work: they head back to their desks for a while.
  busy: string[];
  // The assistant's screen on the wall.
  face: React.ReactNode;
  onTap: (handle: string) => void;
}) {
  const [mates, setMates] = useState<Mate[]>(() =>
    team.map((t) => {
      const p = atDesk(t.handle);
      return { handle: t.handle, ...p, mode: HOME[t.handle].desk ? "desk" : "act", act: HOME[t.handle].desk ? "type" : "read", prop: HOME[t.handle].desk ? "" : "📰", sit: !HOME[t.handle].desk, spot: HOME[t.handle].desk ? "" : t.handle === "Chair" ? "sofa-a" : "sofa-b", until: Date.now() + rand(3000, 12000), moveMs: 0 };
    }),
  );
  // The tick reads the latest props through a ref so the timer is set up once.
  const live = useRef({ speaking, focus, busy });
  live.current = { speaking, focus, busy };
  const [handing, setHanding] = useState(false);
  const lastSpeaker = useRef("");

  // The assistant holds up a folder for a moment when she hands over to a teammate.
  useEffect(() => {
    const was = lastSpeaker.current;
    lastSpeaker.current = speaking;
    if (speaking && speaking !== ASSISTANT && (was === ASSISTANT || was === "")) {
      setHanding(true);
      const t = setTimeout(() => setHanding(false), 2200);
      return () => clearTimeout(t);
    }
  }, [speaking]);

  useEffect(() => {
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      const now = Date.now();
      const { speaking, focus, busy } = live.current;
      setMates((list) => {
        const taken = new Set(list.map((m) => (m.mode === "walk" ? m.next?.spot : m.spot)).filter(Boolean) as string[]);
        let huddles = 0;
        return list.map((m) => {
          const go = (to: Point, next: NonNullable<Mate["next"]>): Mate => {
            const moveMs = calm ? 0 : walkMs(m, to);
            return { ...m, ...to, mode: "walk", act: "", prop: "", sit: false, spot: next.spot, moveMs, until: now + moveMs, next };
          };
          // Talking with Ced: come up front, beside the assistant.
          if (m.handle === speaking || m.handle === focus) {
            const spot = HUDDLE[Math.min(huddles++, HUDDLE.length - 1)];
            if (m.mode === "huddle" || (m.mode === "walk" && m.next?.mode === "huddle")) return m;
            return go(spot, { mode: "huddle", act: "talk", prop: "", sit: false, spot: "huddle", ms: 0 });
          }
          if (m.mode === "walk") {
            if (now < m.until) return m;
            const n = m.next!;
            return { ...m, mode: n.mode, act: n.act, prop: n.prop, sit: n.sit, spot: n.spot, until: now + n.ms, next: undefined, moveMs: 0 };
          }
          const isBusy = busy.includes(m.handle);
          // Done talking, or just given work: back to the desk.
          if (m.mode === "huddle" || (isBusy && m.mode !== "desk")) {
            const home = HOME[m.handle];
            if (!home.desk) return go(home, { mode: "act", act: "read", prop: "📰", sit: true, spot: m.handle === "Chair" ? "sofa-a" : "sofa-b", ms: rand(8000, 16000) });
            return go(atDesk(m.handle), { mode: "desk", act: "type", prop: "", sit: true, spot: "", ms: rand(15000, 30000) });
          }
          if (now < m.until || isBusy || calm) return m;
          // Pick the next thing to do: usually work, sometimes a break.
          const home = HOME[m.handle];
          if (home.desk && Math.random() < 0.5) {
            if (m.mode === "desk") return { ...m, until: now + rand(8000, 20000) };
            return go(atDesk(m.handle), { mode: "desk", act: "type", prop: "", sit: true, spot: "", ms: rand(10000, 25000) });
          }
          const free = SPOTS.filter((s) => !taken.has(s.name) && s.name !== m.spot);
          const spot = free[Math.floor(Math.random() * free.length)];
          if (!spot) return { ...m, until: now + 5000 };
          taken.add(spot.name);
          return go(spot, { mode: "act", act: spot.act, prop: spot.prop, sit: !!spot.sit, spot: spot.name, ms: rand(6000, 14000) });
        });
      });
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, []);

  const assistantTalking = speaking === ASSISTANT;
  const hour = Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila", hour: "numeric", hour12: false }));
  const night = hour >= 18 || hour < 6;
  return (
    <div className="office">
      <div className="wall">
        <div className="whiteboard">
          <span>First 10 agencies</span>
          <i style={{ width: "30%" }} />
        </div>
        <div className="screen">
          {face}
        </div>
        <div className={`window ${night ? "night" : ""}`}>
          <span className="sun" />
        </div>
      </div>
      <div className="floor" />

      {SPOTS.filter((s) => s.name === "coffee").map((s) => (
        <div key={s.name} className="thing coffee" style={{ left: `${s.x + 4}%`, top: `${s.y}%`, zIndex: Math.round(s.y * 10) - 5 }} />
      ))}
      <div className="thing cooler" style={{ left: "84%", top: "31%", zIndex: 300 }} />
      <div className="thing plant" style={{ left: "3%", top: "64%", zIndex: 630 }} />
      <div className="thing sofa" style={{ left: "14.5%", top: "85%", zIndex: 830 }} />

      {Object.entries(HOME)
        .filter(([, h]) => h.desk)
        .map(([handle, h]) => (
          <div key={handle} className="desk" style={{ left: `${h.x}%`, top: `${h.y}%`, zIndex: Math.round(h.y * 10) + 8, ["--s" as string]: scale(h.y) }}>
            <span className="monitor" />
          </div>
        ))}
      <div className="desk front" style={{ left: `${FRONT_DESK.x}%`, top: `${FRONT_DESK.y}%`, zIndex: Math.round(FRONT_DESK.y * 10) + 8, ["--s" as string]: scale(FRONT_DESK.y) }}>
        <span className="monitor" />
        <span className="sign">KRO5</span>
      </div>

      <Bot
        handle={ASSISTANT}
        x={FRONT_DESK.x}
        y={FRONT_DESK.y + 0.5}
        mode="desk"
        act={handing ? "hand" : "type"}
        prop={handing ? "📁" : ""}
        sit
        moveMs={0}
        talking={assistantTalking}
        listening={focus === ASSISTANT && status === "listening"}
        thinking={focus === ASSISTANT && status === "thinking"}
        focused={focus === ASSISTANT}
        busy={false}
        onTap={onTap}
      />
      {mates.map((m) => (
        <Bot
          key={m.handle}
          {...m}
          talking={speaking === m.handle}
          listening={focus === m.handle && status === "listening"}
          thinking={focus === m.handle && status === "thinking"}
          focused={focus === m.handle}
          busy={busy.includes(m.handle) && m.mode === "desk"}
          onTap={onTap}
        />
      ))}
    </div>
  );
}

function Bot({
  handle,
  x,
  y,
  mode,
  act,
  prop,
  sit,
  moveMs,
  talking,
  listening,
  thinking,
  focused,
  busy,
  onTap,
}: Point & {
  handle: string;
  mode: Mode;
  act: string;
  prop: string;
  sit: boolean;
  moveMs: number;
  talking: boolean;
  listening: boolean;
  thinking: boolean;
  focused: boolean;
  busy: boolean;
  onTap: (handle: string) => void;
}) {
  const look = LOOKS[handle];
  const style = {
    left: `${x}%`,
    top: `${y}%`,
    zIndex: Math.round(y * 10),
    transitionDuration: `${moveMs}ms`,
    ["--s" as string]: scale(y),
    ["--skin" as string]: look.skin,
    ["--shirt" as string]: look.shirt,
    ["--pants" as string]: look.pants,
    ["--hair" as string]: look.hairColor,
  };
  const classes = ["bot", `m-${mode}`, `act-${act}`, sit ? "sit" : "", talking ? "talking" : "", listening ? "listening" : "", focused ? "focused" : "", `hair-${look.hair}`, ...look.extras.map((e) => `x-${e}`)];
  return (
    <button className={classes.filter(Boolean).join(" ")} style={style} onClick={() => onTap(handle)} aria-label={`Talk to ${look.tag}`}>
      <span className="above">{talking ? "💬" : listening ? "👂" : thinking ? "💭" : busy ? "✅" : ""}</span>
      <span className="head">
        <span className="hair" />
        <span className="eyes" />
        <span className="mouth" />
      </span>
      <span className="body">
        <span className="arm l" />
        <span className="arm r">{prop && <span className="prop">{prop}</span>}</span>
      </span>
      <span className="legs">
        <span className="leg" />
        <span className="leg" />
      </span>
      <span className="name">{look.tag}</span>
    </button>
  );
}
