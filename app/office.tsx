"use client";

import { useEffect, useRef, useState } from "react";
import { ASSISTANT, team } from "@/lib/team";

// The office: Ced's assistant at the front desk and the team as blocky characters. Teammates work at their
// desks or wander off to the pantry, the break room and around the office; whoever is talking comes up
// front by the assistant's desk.

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

// The floor plan, in percent of the office: the open work area at the back, and along the front the pantry
// (left), the reception with the assistant's desk (middle) and the break room (right). Glass walls close off
// the pantry and break room, so people walk in and out through their doors.
const ROOM_TOP = 64;
const PANTRY_RIGHT = 30;
const BREAK_LEFT = 70;
const DOORS = { pantry: 22.5, break: 77.5 };
// The walkway between the desks and the rooms.
const HALL = 60;

type Zone = "open" | "pantry" | "break" | "reception";
function zone(p: Point): Zone {
  if (p.y <= ROOM_TOP + 0.5) return "open";
  return p.x < PANTRY_RIGHT ? "pantry" : p.x > BREAK_LEFT ? "break" : "reception";
}

// The way from one place to another without walking through a wall.
function route(from: Point, to: Point): Point[] {
  const a = zone(from);
  const b = zone(to);
  if (a === b) return [to];
  const way: Point[] = [];
  if (a === "pantry" || a === "break") way.push({ x: DOORS[a], y: ROOM_TOP + 4 }, { x: DOORS[a], y: HALL });
  else if (a === "reception") way.push({ x: from.x, y: HALL });
  if (b === "pantry" || b === "break") way.push({ x: DOORS[b], y: HALL }, { x: DOORS[b], y: ROOM_TOP + 4 });
  else if (b === "reception") way.push({ x: to.x, y: HALL });
  way.push(to);
  return way.filter((p, i) => i === 0 || p.x !== way[i - 1].x || p.y !== way[i - 1].y);
}

// Where each teammate works. The board has no desks: they put their feet up in the break room.
const HOME: Record<string, Point & { desk: boolean; spot?: string }> = {
  CTO: { x: 14, y: 38, desk: true },
  CFO: { x: 38, y: 38, desk: true },
  CMO: { x: 62, y: 38, desk: true },
  COO: { x: 86, y: 38, desk: true },
  "Chief of Staff": { x: 14, y: 53, desk: true },
  "VA Lead": { x: 38, y: 53, desk: true },
  "Courts Lead": { x: 62, y: 53, desk: true },
  "General Counsel": { x: 86, y: 53, desk: true },
  Chair: { x: 79, y: 90, desk: false, spot: "sofa-a" },
  "Independent Director": { x: 91, y: 90, desk: false, spot: "sofa-b" },
};
const FRONT_DESK = { x: 50, y: 85 };
// Where a teammate stands to talk with Ced, beside the assistant's desk.
const HUDDLE = [
  { x: 65, y: 91 },
  { x: 35, y: 91 },
];

type Spot = Point & { name: string; act: string; prop: string; sit?: boolean };
// Things to do when they're not working.
const SPOTS: Spot[] = [
  // Work area
  { name: "board", x: 20, y: 27, act: "write", prop: "🖊️" },
  { name: "window", x: 71, y: 27, act: "look", prop: "" },
  { name: "cooler", x: 85, y: 30, act: "sip", prop: "🥤" },
  { name: "plant", x: 9, y: 48, act: "water", prop: "🚿" },
  { name: "stretch", x: 50, y: 45, act: "stretch", prop: "" },
  // Pantry
  { name: "fridge", x: 6, y: 78, act: "fridge", prop: "🥪" },
  { name: "coffee", x: 15, y: 75, act: "sip", prop: "☕" },
  { name: "microwave", x: 24, y: 75, act: "wait", prop: "🍜" },
  { name: "table-a", x: 9, y: 87, act: "eat", prop: "🍩", sit: true },
  { name: "table-b", x: 21, y: 87, act: "eat", prop: "🍜", sit: true },
  // Break room
  { name: "game-a", x: 76, y: 80, act: "game", prop: "🎮", sit: true },
  { name: "game-b", x: 94, y: 80, act: "game", prop: "🎮", sit: true },
  { name: "sofa-a", x: 79, y: 90, act: "phone", prop: "📱", sit: true },
  { name: "sofa-b", x: 91, y: 90, act: "read", prop: "📰", sit: true },
];

type Mode = "desk" | "walk" | "act" | "huddle";
type Next = { mode: Mode; act: string; prop: string; sit: boolean; spot: string; ms: number };
type Mate = Point & {
  handle: string;
  mode: Mode;
  act: string;
  prop: string;
  sit: boolean;
  spot: string;
  until: number;
  moveMs: number;
  // The rest of the way, and what they do once they get there.
  path: Point[];
  next?: Next;
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);
// Further back looks smaller.
const scale = (y: number) => 0.6 + (y / 100) * 0.5;

function walkMs(from: Point, to: Point) {
  return Math.max(500, Math.hypot(from.x - to.x, (from.y - to.y) * 1.6) * 70);
}

function atDesk(handle: string): Point {
  const home = HOME[handle];
  // Just in front of the desk's back edge, so the desk hides their legs.
  return home.desk ? { x: home.x, y: home.y + 0.5 } : home;
}

function homeNext(handle: string): Next {
  const home = HOME[handle];
  return home.desk
    ? { mode: "desk", act: "type", prop: "", sit: true, spot: "", ms: rand(15000, 30000) }
    : { mode: "act", act: "read", prop: "📰", sit: true, spot: home.spot!, ms: rand(8000, 16000) };
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
      const next = homeNext(t.handle);
      return { handle: t.handle, ...atDesk(t.handle), ...next, until: Date.now() + rand(3000, 12000), moveMs: 0, path: [] };
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
          // Sets off along the way to `to`, one straight stretch at a time.
          const go = (to: Point, next: Next): Mate => {
            const [first, ...rest] = calm ? [to] : route(m, to);
            const moveMs = calm ? 0 : walkMs(m, first);
            return { ...m, ...first, path: rest, mode: "walk", act: "", prop: "", sit: false, spot: next.spot, moveMs, until: now + moveMs, next };
          };
          // Talking with Ced: come up front, beside the assistant.
          if (m.handle === speaking || m.handle === focus) {
            const spot = HUDDLE[Math.min(huddles++, HUDDLE.length - 1)];
            if (m.mode === "huddle" || (m.mode === "walk" && m.next?.mode === "huddle")) return m;
            return go(spot, { mode: "huddle", act: "talk", prop: "", sit: false, spot: "huddle", ms: 0 });
          }
          if (m.mode === "walk") {
            if (now < m.until) return m;
            if (m.path.length) {
              const [step, ...rest] = m.path;
              const moveMs = walkMs(m, step);
              return { ...m, ...step, path: rest, moveMs, until: now + moveMs };
            }
            const n = m.next!;
            return { ...m, mode: n.mode, act: n.act, prop: n.prop, sit: n.sit, spot: n.spot, until: now + n.ms, next: undefined, moveMs: 0 };
          }
          const isBusy = busy.includes(m.handle);
          // Done talking, or just given work: back to the desk.
          if (m.mode === "huddle" || (isBusy && m.mode !== "desk" && HOME[m.handle].desk)) return go(atDesk(m.handle), homeNext(m.handle));
          if (now < m.until || isBusy || calm) return m;
          // Pick the next thing to do: usually work, sometimes a break.
          if (HOME[m.handle].desk && Math.random() < 0.5) {
            if (m.mode === "desk") return { ...m, until: now + rand(8000, 20000) };
            return go(atDesk(m.handle), homeNext(m.handle));
          }
          const free = SPOTS.filter((s) => !taken.has(s.name) && s.name !== m.spot);
          const spot = free[Math.floor(Math.random() * free.length)];
          if (!spot) return { ...m, until: now + 5000 };
          taken.add(spot.name);
          return go(spot, { mode: "act", act: spot.act, prop: spot.prop, sit: !!spot.sit, spot: spot.name, ms: rand(7000, 16000) });
        });
      });
    };
    tick();
    const timer = setInterval(tick, 400);
    return () => clearInterval(timer);
  }, []);

  const assistantTalking = speaking === ASSISTANT;
  const hour = Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila", hour: "numeric", hour12: false }));
  const night = hour >= 18 || hour < 6;
  // A piece of furniture, drawn in front of people further back and behind people nearer the front.
  const item = (kind: string, x: number, y: number, children?: React.ReactNode, depth = 0) => (
    <div key={`${kind}-${x}-${y}`} className={`thing ${kind}`} style={{ left: `${x}%`, top: `${y}%`, zIndex: Math.round(y * 10) + depth, ["--s" as string]: scale(y) }}>
      {children}
    </div>
  );

  return (
    <div className={`office ${night ? "night" : ""}`}>
      <div className="side-wall left" />
      <div className="side-wall right" />
      <div className="wall">
        <div className="whiteboard">
          <span>First 10 agencies</span>
          <em />
          <em />
          <i />
        </div>
        <div className="screen">{face}</div>
        <div className="window">
          <span className="sun" />
        </div>
        <span className="lamp" style={{ left: "25%" }} />
        <span className="lamp" style={{ left: "75%" }} />
      </div>
      <div className="floor" />
      <div className="room pantry" />
      <div className="room break" />
      <div className="rug" />

      {/* Glass walls, with a gap for each door. */}
      <div className="glass" style={{ left: 0, width: `${DOORS.pantry - 4.5}%`, top: `${ROOM_TOP}%` }} />
      <div className="glass" style={{ left: `${DOORS.pantry + 4.5}%`, width: `${PANTRY_RIGHT - DOORS.pantry - 4.5}%`, top: `${ROOM_TOP}%` }} />
      <div className="glass" style={{ left: `${BREAK_LEFT}%`, width: `${DOORS.break - 4.5 - BREAK_LEFT}%`, top: `${ROOM_TOP}%` }} />
      <div className="glass" style={{ left: `${DOORS.break + 4.5}%`, right: 0, top: `${ROOM_TOP}%` }} />
      <div className="glass side" style={{ left: `${PANTRY_RIGHT}%`, top: `${ROOM_TOP}%` }} />
      <div className="glass side" style={{ left: `${BREAK_LEFT}%`, top: `${ROOM_TOP}%` }} />
      <span className="room-sign" style={{ left: `${(DOORS.pantry - 4.5) / 2}%`, top: `${ROOM_TOP}%` }}>Pantry</span>
      <span className="room-sign" style={{ left: `${(DOORS.break + 4.5 + 100) / 2}%`, top: `${ROOM_TOP}%` }}>Break room</span>

      {item("cooler", 89, 29, null, -5)}
      {item("plant tall", 4, 46, null, -5)}
      {item("plant", 97, 78, null, -5)}

      {/* Pantry */}
      {item("fridge", 4, 76, null, -8)}
      {item("counter", 19.5, 72, <><span className="machine" /><span className="micro" /><span className="kettle" /></>, -8)}
      {item("table", 15, 89, <span className="snack">🍪</span>, 5)}

      {/* Break room */}
      {item("tv", 85, 71, <span className="tv-screen" />, -8)}
      {item("beanbag", 76, 82, null, 3)}
      {item("beanbag blue", 94, 82, null, 3)}
      {item("sofa", 85, 93, null, 5)}

      {Object.entries(HOME)
        .filter(([, h]) => h.desk)
        .map(([handle, h]) => (
          <div key={handle}>
            <div className="chair" style={{ left: `${h.x}%`, top: `${h.y}%`, zIndex: Math.round(h.y * 10) - 2, ["--s" as string]: scale(h.y) }} />
            <div className="desk" style={{ left: `${h.x}%`, top: `${h.y}%`, zIndex: Math.round(h.y * 10) + 8, ["--s" as string]: scale(h.y) }}>
              <span className="monitor" />
              <span className="mug" />
            </div>
          </div>
        ))}
      <div className="chair" style={{ left: `${FRONT_DESK.x}%`, top: `${FRONT_DESK.y}%`, zIndex: Math.round(FRONT_DESK.y * 10) - 2, ["--s" as string]: scale(FRONT_DESK.y) }} />
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
          handle={m.handle}
          x={m.x}
          y={m.y}
          mode={m.mode}
          act={m.act}
          prop={m.prop}
          sit={m.sit}
          moveMs={m.moveMs}
          talking={speaking === m.handle}
          listening={focus === m.handle && status === "listening"}
          thinking={focus === m.handle && status === "thinking"}
          focused={focus === m.handle}
          busy={busy.includes(m.handle) && m.mode === "desk"}
          onTap={onTap}
        />
      ))}
      <div className="light" />
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
      <span className="shadow" />
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
