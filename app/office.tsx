"use client";

import { useEffect, useRef, useState } from "react";
import { ASSISTANT, team } from "@/lib/team";

// The office, seen from above at an angle like The Sims: a floor plan drawn in isometric view with the
// front walls cut away. Ced's assistant sits at the reception desk; the team work at their desks or wander
// off to the pantry, the break room and around the office. Whoever is talking comes over to the reception.

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

// The floor plan, in tiles. x runs down to the right on screen and y down to the left; the back walls stand
// along x = 0 and y = 0, and the front walls are cut away so the room can be seen into.
const SIZE = 12;
const WALL = 2.4;
// Floor tiles plus the back walls' height, in tiles, top to bottom on screen.
const TALL = SIZE + WALL;

// Rooms: the pantry in the left corner and the break room along the back right, each behind low walls with
// a doorway. Everything else is the open office.
const PANTRY = { x1: 4.5, y0: 7.5 };
const BREAK = { x0: 7.5, y1: 4.5 };
type Zone = "open" | "pantry" | "break";
function zone(p: Point): Zone {
  if (p.x < PANTRY.x1 && p.y > PANTRY.y0) return "pantry";
  if (p.x > BREAK.x0 && p.y < BREAK.y1) return "break";
  return "open";
}
// Each room's doorway: a point just inside and one just outside.
const DOORS: Record<Exclude<Zone, "open">, { inside: Point; outside: Point }> = {
  pantry: { inside: { x: 2.9, y: 8.3 }, outside: { x: 2.9, y: 6.9 } },
  break: { inside: { x: 8.3, y: 3 }, outside: { x: 6.9, y: 3 } },
};

// The way from one place to another through the doorways, not through walls.
function route(from: Point, to: Point): Point[] {
  const a = zone(from);
  const b = zone(to);
  if (a === b) return [to];
  const way: Point[] = [];
  if (a !== "open") way.push(DOORS[a].inside, DOORS[a].outside);
  if (b !== "open") way.push(DOORS[b].outside, DOORS[b].inside);
  way.push(to);
  return way;
}

// Desks: where each teammate works, by the desk's back corner. The board has no desks: they relax on the
// break room sofa.
const DESKS: Record<string, Point> = {
  CTO: { x: 1.2, y: 1.8 },
  CFO: { x: 3.4, y: 1.8 },
  CMO: { x: 5.6, y: 1.8 },
  COO: { x: 1.2, y: 4 },
  "Chief of Staff": { x: 3.4, y: 4 },
  "VA Lead": { x: 5.6, y: 4 },
  "Courts Lead": { x: 1.2, y: 6.1 },
  "General Counsel": { x: 3.4, y: 6.1 },
};
const SOFA_SEATS: Record<string, string> = { Chair: "sofa-a", "Independent Director": "sofa-b" };
const RECEPTION = { x: 8.6, y: 8.6 };
const ASSISTANT_SEAT = { x: 9.7, y: 8.45 };
// Where a teammate stands to talk with Ced, at either end of the reception desk.
const HUDDLE = [
  { x: 11.4, y: 9 },
  { x: 8.1, y: 9.8 },
];

type Spot = Point & { name: string; act: string; prop: string; sit?: boolean };
// Things to do when they're not working.
const SPOTS: Spot[] = [
  // Open office
  { name: "whiteboard", x: 0.7, y: 3.1, act: "write", prop: "🖊️" },
  { name: "cooler", x: 6.9, y: 1.2, act: "sip", prop: "🥤" },
  { name: "plant", x: 1.1, y: 0.9, act: "water", prop: "🚿" },
  { name: "stretch", x: 5.8, y: 6.6, act: "stretch", prop: "" },
  { name: "screen", x: 4.6, y: 0.8, act: "look", prop: "" },
  // Pantry
  { name: "fridge", x: 1.3, y: 11.3, act: "fridge", prop: "🥪" },
  { name: "coffee", x: 1.2, y: 8.6, act: "sip", prop: "☕" },
  { name: "microwave", x: 1.2, y: 10.1, act: "wait", prop: "🍜" },
  { name: "table-a", x: 2.7, y: 9.2, act: "eat", prop: "🍩", sit: true },
  { name: "table-b", x: 3.6, y: 9.2, act: "eat", prop: "🍜", sit: true },
  // Break room
  { name: "game-a", x: 8.6, y: 2.2, act: "game", prop: "🎮", sit: true },
  { name: "game-b", x: 10.6, y: 2.2, act: "game", prop: "🎮", sit: true },
  { name: "window", x: 11.3, y: 1.3, act: "look", prop: "" },
  { name: "sofa-a", x: 9.1, y: 0.75, act: "phone", prop: "📱", sit: true },
  { name: "sofa-b", x: 10.4, y: 0.75, act: "read", prop: "📰", sit: true },
];
const spotAt = (name: string) => SPOTS.find((s) => s.name === name)!;

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

function walkMs(from: Point, to: Point) {
  return Math.max(400, Math.hypot(from.x - to.x, from.y - to.y) * 520);
}

// Where someone sits to work: behind their desk, facing the room.
function seat(handle: string): Point {
  const desk = DESKS[handle];
  if (desk) return { x: desk.x + 0.6, y: desk.y - 0.15 };
  const spot = spotAt(SOFA_SEATS[handle]);
  return { x: spot.x, y: spot.y };
}

function homeNext(handle: string): Next {
  return DESKS[handle]
    ? { mode: "desk", act: "type", prop: "", sit: true, spot: "", ms: rand(15000, 30000) }
    : { mode: "act", act: "read", prop: "📰", sit: true, spot: SOFA_SEATS[handle], ms: rand(8000, 16000) };
}

// ---- Drawing in isometric view. `t` is a tile's width in pixels; a tile is t wide and t/2 deep on screen.

type Box = { x: number; y: number; w: number; d: number; h: number; z?: number; color: string };

function iso(t: number, x: number, y: number, z = 0): [number, number] {
  return [(SIZE + x - y) * t, (WALL + (x + y) / 2 - z) * t];
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

// A block: its top and the two faces that face the viewer, lit from the left.
function boxFaces(t: number, b: Box, key: string) {
  const z = b.z ?? 0;
  const pts = (list: [number, number, number][]) => list.map(([x, y, h]) => iso(t, x, y, h).join(",")).join(" ");
  const { x, y, w, d, h } = b;
  return (
    <g key={key}>
      <polygon points={pts([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]])} fill={shade(b.color, 0.82)} />
      <polygon points={pts([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]])} fill={shade(b.color, 0.64)} />
      <polygon points={pts([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]])} fill={b.color} />
    </g>
  );
}

// A piece of furniture: blocks drawn on their own layer, so people in front of it cover it and people
// behind it are covered.
type Piece = { depth: number; boxes: Box[] };

function piece(boxes: Box[], depth?: number): Piece {
  const front = Math.max(...boxes.map((b) => b.x + b.w / 2 + b.y + b.d / 2));
  return { depth: depth ?? front, boxes };
}

const WOOD = "#c8925a";

// A potted plant centred on (x, y): a pot and three tiers of leaves, narrower toward the top.
function plant(x: number, y: number, size: number): Piece {
  const tier = (w: number, z: number, h: number, color: string): Box => ({ x: x - w / 2, y: y - w / 2, w, d: w, h, z, color });
  return piece([
    tier(0.42, 0, 0.38, "#b5651d"),
    tier(0.8 * size, 0.38, 0.35 * size, "#2f9e44"),
    tier(0.6 * size, 0.38 + 0.35 * size, 0.3 * size, "#3fae5c"),
    tier(0.36 * size, 0.38 + 0.65 * size, 0.25 * size, "#5cc76f"),
  ]);
}
const DESK_PIECES: Piece[] = Object.values(DESKS).flatMap(({ x, y }) => [
  // Chair back, behind the person.
  piece([{ x: x + 0.3, y: y - 0.75, w: 0.6, d: 0.2, h: 0.8, color: "#4a5568" }], x + y - 0.6),
  piece([
    { x, y, w: 1.2, d: 0.7, h: 0.72, color: WOOD },
    { x: x + 0.3, y: y + 0.08, w: 0.6, d: 0.08, h: 0.42, z: 0.72, color: "#1c2333" },
    { x: x + 0.95, y: y + 0.4, w: 0.12, d: 0.12, h: 0.14, z: 0.72, color: "#f1f3f8" },
  ]),
]);

const PIECES: Piece[] = [
  ...DESK_PIECES,
  // Open office: water cooler, corner plant, a second plant by the pantry.
  piece([{ x: 6.6, y: 0.3, w: 0.5, d: 0.5, h: 0.9, color: "#e7ecf3" }, { x: 6.68, y: 0.38, w: 0.34, d: 0.34, h: 0.45, z: 0.9, color: "#8fd3ff" }]),
  plant(0.5, 0.5, 1.2),
  plant(6.1, 7.4, 0.9),
  // Reception desk.
  piece([{ x: RECEPTION.x, y: RECEPTION.y, w: 2.2, d: 0.8, h: 0.9, color: "#2bd4a4" }, { x: RECEPTION.x + 0.8, y: RECEPTION.y + 0.1, w: 0.6, d: 0.08, h: 0.45, z: 0.9, color: "#1c2333" }]),
  piece([{ x: ASSISTANT_SEAT.x - 0.3, y: ASSISTANT_SEAT.y - 0.6, w: 0.6, d: 0.2, h: 0.8, color: "#4a5568" }], ASSISTANT_SEAT.x + ASSISTANT_SEAT.y - 0.5),
  // Pantry: counter with a coffee machine and microwave along the wall, fridge in the corner, a table.
  piece([
    { x: 0, y: 8, w: 0.7, d: 2.9, h: 0.9, color: "#e9edf3" },
    { x: 0.1, y: 8.25, w: 0.45, d: 0.45, h: 0.5, z: 0.9, color: "#c0392b" },
    { x: 0.08, y: 9.7, w: 0.5, d: 0.75, h: 0.38, z: 0.9, color: "#dfe4ec" },
  ], 0.35 + 9.4),
  piece([{ x: 0, y: 11.05, w: 0.8, d: 0.9, h: 2, color: "#f4f6fa" }]),
  piece([{ x: 2.4, y: 9.4, w: 1.4, d: 1.1, h: 0.72, color: "#e0b07a" }, { x: 2.9, y: 9.8, w: 0.3, d: 0.3, h: 0.1, z: 0.72, color: "#f4a261" }]),
  // Break room: sofa against the wall, TV, beanbags, a plant.
  piece([{ x: 8.5, y: 0.05, w: 2.6, d: 0.3, h: 1, color: "#7d5cb0" }], 9.9),
  piece([{ x: 8.5, y: 0.35, w: 2.6, d: 0.85, h: 0.42, color: "#8b6bc2" }]),
  piece([{ x: 8.95, y: 3.6, w: 1.9, d: 0.5, h: 0.45, color: "#5c3a1a" }, { x: 9.15, y: 3.72, w: 1.5, d: 0.14, h: 0.95, z: 0.45, color: "#14161c" }]),
  piece([{ x: 8.3, y: 2.25, w: 0.7, d: 0.6, h: 0.32, color: "#ffb703" }]),
  piece([{ x: 10.3, y: 2.25, w: 0.7, d: 0.6, h: 0.32, color: "#4cc9f0" }]),
  plant(11.6, 0.45, 1),
];

// Floor tile colours by room.
function tile(x: number, y: number): string {
  const odd = (x + y) % 2 === 1;
  const z = zone({ x: x + 0.5, y: y + 0.5 });
  if (z === "pantry") return odd ? "#dfe4ec" : "#c9d0dc";
  if (z === "break") return odd ? "#7a5fae" : "#7056a3";
  return odd ? "#c49a6c" : "#b98d5f";
}

// Low cut-away walls around the rooms, with gaps for the doorways.
const LOW_WALLS: Box[] = [
  { x: 0, y: PANTRY.y0 - 0.1, w: 2.5, d: 0.15, h: 0.55, color: "#e8dcc8" },
  { x: 3.3, y: PANTRY.y0 - 0.1, w: PANTRY.x1 - 3.3, d: 0.15, h: 0.55, color: "#e8dcc8" },
  { x: PANTRY.x1 - 0.1, y: PANTRY.y0, w: 0.15, d: SIZE - PANTRY.y0, h: 0.55, color: "#e8dcc8" },
  { x: BREAK.x0 - 0.1, y: 0, w: 0.15, d: 2.5, h: 0.55, color: "#e8dcc8" },
  { x: BREAK.x0 - 0.1, y: 3.5, w: 0.15, d: BREAK.y1 - 3.5, h: 0.55, color: "#e8dcc8" },
  { x: BREAK.x0, y: BREAK.y1 - 0.1, w: SIZE - BREAK.x0, d: 0.15, h: 0.55, color: "#e8dcc8" },
];

// Something hung on a back wall, from a to b along it and lo to hi up it, as a CSS box skewed onto the wall.
function onWall(t: number, wall: "left" | "right", a: number, b: number, lo: number, hi: number): React.CSSProperties {
  if (wall === "right") {
    const [left, top] = iso(t, a, 0, hi);
    return { left, top, width: (b - a) * t, height: (hi - lo) * t, transform: "skewY(26.565deg)" };
  }
  const [left, top] = iso(t, 0, b, hi);
  return { left, top, width: (b - a) * t, height: (hi - lo) * t, transform: "skewY(-26.565deg)" };
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
    team.map((t) => ({ handle: t.handle, ...seat(t.handle), ...homeNext(t.handle), until: Date.now() + rand(3000, 12000), moveMs: 0, path: [] })),
  );
  // The tick reads the latest props through a ref so the timer is set up once.
  const live = useRef({ speaking, focus, busy });
  live.current = { speaking, focus, busy };
  const [handing, setHanding] = useState(false);
  const lastSpeaker = useRef("");
  // The tile size follows the screen width; the room scrolls sideways (and up and down when space is short).
  const scroller = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(30);
  const [gap, setGap] = useState(0);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let centred = false;
    const fit = () => {
      // About two screens wide. It follows the width only, so the room doesn't zoom when the dialogue box grows.
      const size = Math.max(18, Math.min(44, (el.clientWidth * 2.1) / (SIZE * 2)));
      setT(size);
      // Any height left over goes above and below, so the room sits in the middle.
      setGap(Math.max(0, (el.clientHeight - TALL * size) / 2));
      // Start looking at the reception, where the conversation happens.
      if (!centred && el.clientWidth) {
        centred = true;
        requestAnimationFrame(() => (el.scrollLeft = iso(size, 7.5, 7.5)[0] - el.clientWidth / 2));
      }
    };
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    fit();
    return () => observer.disconnect();
  }, []);

  // The assistant holds up a folder for a moment when she hands over to a teammate.
  useEffect(() => {
    const was = lastSpeaker.current;
    lastSpeaker.current = speaking;
    if (speaking && speaking !== ASSISTANT && (was === ASSISTANT || was === "")) {
      setHanding(true);
      const timer = setTimeout(() => setHanding(false), 2200);
      return () => clearTimeout(timer);
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
          // Talking with Ced: come over to the reception.
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
          if (m.mode === "huddle" || (isBusy && m.mode !== "desk" && DESKS[m.handle])) return go(seat(m.handle), homeNext(m.handle));
          if (now < m.until || isBusy || calm) return m;
          // Pick the next thing to do: usually work, sometimes a break.
          if (DESKS[m.handle] && Math.random() < 0.5) {
            if (m.mode === "desk") return { ...m, until: now + rand(8000, 20000) };
            return go(seat(m.handle), homeNext(m.handle));
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

  const hour = Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila", hour: "numeric", hour12: false }));
  const night = hour >= 18 || hour < 6;
  const width = SIZE * 2 * t;
  const height = TALL * t;
  const layer = (z: number, children: React.ReactNode, key: string) => (
    <svg key={key} className="layer" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ zIndex: z }} aria-hidden="true">
      {children}
    </svg>
  );
  const depthZ = (depth: number) => Math.round(depth * 100);
  const wallTop = (x: number, y: number) => iso(t, x, y, WALL).join(",");
  const wallFoot = (x: number, y: number) => iso(t, x, y, 0).join(",");

  return (
    <div ref={scroller} className={`office-scroll ${night ? "night" : ""}`}>
      <div className="office" style={{ width, height, marginTop: gap }}>
        {layer(
          0,
          <>
            {/* Back walls: the right one along y = 0, the left one along x = 0, with the pantry and break room
                sections painted to match their rooms. */}
            <polygon points={`${wallFoot(0, 0)} ${wallFoot(SIZE, 0)} ${wallTop(SIZE, 0)} ${wallTop(0, 0)}`} fill="#cfd8c6" />
            <polygon points={`${wallFoot(BREAK.x0, 0)} ${wallFoot(SIZE, 0)} ${wallTop(SIZE, 0)} ${wallTop(BREAK.x0, 0)}`} fill="#f2c6a0" />
            <polygon points={`${wallFoot(0, 0)} ${wallFoot(0, SIZE)} ${wallTop(0, SIZE)} ${wallTop(0, 0)}`} fill="#bcc7b2" />
            <polygon points={`${wallFoot(0, PANTRY.y0)} ${wallFoot(0, SIZE)} ${wallTop(0, SIZE)} ${wallTop(0, PANTRY.y0)}`} fill="#cfe0e8" />
            {/* Skirting and the wall tops. */}
            <polyline points={`${wallFoot(0, SIZE)} ${wallFoot(0, 0)} ${wallFoot(SIZE, 0)}`} fill="none" stroke="#6b5a48" strokeWidth={t * 0.12} />
            <polyline points={`${wallTop(0, SIZE)} ${wallTop(0, 0)} ${wallTop(SIZE, 0)}`} fill="none" stroke="#f4efe6" strokeWidth={t * 0.18} strokeLinejoin="round" />
            {Array.from({ length: SIZE * SIZE }, (_, i) => {
              const x = i % SIZE;
              const y = Math.floor(i / SIZE);
              const corners = [iso(t, x, y), iso(t, x + 1, y), iso(t, x + 1, y + 1), iso(t, x, y + 1)];
              return <polygon key={i} points={corners.map((c) => c.join(",")).join(" ")} fill={tile(x, y)} stroke="rgba(0,0,0,0.08)" strokeWidth={0.6} />;
            })}
            {/* A rug in the break room, and the floor's edge. */}
            <polygon points={[iso(t, 8.4, 1.5), iso(t, 11.2, 1.5), iso(t, 11.2, 3.3), iso(t, 8.4, 3.3)].map((c) => c.join(",")).join(" ")} fill="#e76f51" opacity={0.85} />
            <polyline points={`${wallFoot(SIZE, 0)} ${wallFoot(SIZE, SIZE)} ${wallFoot(0, SIZE)}`} fill="none" stroke="#5a4634" strokeWidth={t * 0.25} />
          </>,
          "floor",
        )}

        {/* Things on the walls. */}
        <div className="on-wall whiteboard" style={onWall(t, "left", 1.6, 4.4, 0.9, 1.9)}>
          <span>First 10 agencies</span>
          <em />
          <em />
          <i />
        </div>
        <div className="on-wall screen" style={onWall(t, "right", 1.8, 5.4, 0.75, 2.15)}>
          {face}
        </div>
        <div className="on-wall window" style={onWall(t, "right", 8.6, 11.2, 0.9, 2)}>
          <span className="sun" />
        </div>
        <div className="on-wall room-sign" style={onWall(t, "left", 8.8, 10.8, 1.75, 2.15)}>
          Pantry
        </div>
        <div className="on-wall room-sign" style={onWall(t, "right", 8.8, 10.8, 2.05, 2.35)}>
          Break room
        </div>

        {LOW_WALLS.map((b, i) => layer(depthZ(b.x + b.w + b.y + b.d) - 30, boxFaces(t, b, "w"), `lw-${i}`))}
        {PIECES.map((p, i) => layer(depthZ(p.depth), p.boxes.map((b, k) => boxFaces(t, b, String(k))), `p-${i}`))}

        <Bot
          handle={ASSISTANT}
          t={t}
          {...ASSISTANT_SEAT}
          mode="desk"
          act={handing ? "hand" : "type"}
          prop={handing ? "📁" : ""}
          sit
          moveMs={0}
          talking={speaking === ASSISTANT}
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
            t={t}
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
      </div>
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
  t,
}: Point & {
  t: number;
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
  const [left, top] = iso(t, x, y);
  const style = {
    left,
    top,
    zIndex: Math.round((x + y) * 100),
    transitionDuration: `${moveMs}ms`,
    // People stand about 1.7 tiles tall.
    ["--s" as string]: (t * 1.7) / 86,
    ["--skin" as string]: look.skin,
    ["--shirt" as string]: look.shirt,
    ["--pants" as string]: look.pants,
    ["--hair" as string]: look.hairColor,
  };
  const classes = ["bot", `m-${mode}`, `act-${act}`, sit ? "sit" : "", talking ? "talking" : "", listening ? "listening" : "", focused ? "focused" : "", `hair-${look.hair}`, ...look.extras.map((e) => `x-${e}`)];
  return (
    <button className={classes.filter(Boolean).join(" ")} style={style} onClick={() => onTap(handle)} aria-label={`Talk to ${look.tag}`}>
      <span className="shadow" />
      {focused && <span className="plumbob" />}
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
