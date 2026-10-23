"use client";

import { useEffect, useRef, useState } from "react";
import { ASSISTANT, team } from "@/lib/team";

// The office, seen from above at an angle like The Sims: a floor plan drawn in isometric view with the
// front walls cut away. It's laid out as an homage to the paper company office in the TV show The Office:
// reception by the door, the bullpen, an accounting pod, the boss's glass-walled office, a conference room,
// the kitchen and the annex. Each teammate is styled after one of the show's characters. Ced's assistant sits
// at reception; whoever is talking comes over to her desk.

type Hair = "short" | "long" | "bun" | "spiky" | "grey" | "bald" | "part" | "receding";
type Extra = "glasses" | "tie" | "headset" | "cap" | "headphones" | "beard" | "bowtie" | "sweatband" | "clipboard" | "jacket" | "cardigan";
type Look = {
  skin: string;
  shirt: string;
  pants: string;
  hair: Hair;
  hairColor: string;
  extras: Extra[];
  tag: string;
  // The character they're styled after, shown when Ced holds a finger on them.
  after: string;
  // Suit jacket or cardigan colour, and tie colour, when they wear one.
  jacket?: string;
  tie?: string;
};

const LOOKS: Record<string, Look> = {
  // The receptionist: auburn hair, pastel cardigan, phone headset.
  [ASSISTANT]: { skin: "#f2c9a0", shirt: "#f3e6d8", jacket: "#e9a5b8", pants: "#5b6b8c", hair: "long", hairColor: "#a0522d", extras: ["headset", "cardigan"], tag: "KRO5", after: "Pam" },
  // The prankster: messy brown hair, light blue shirt and a loose tie.
  "Chief of Staff": { skin: "#efc39b", shirt: "#a9cbee", tie: "#2f3e5c", pants: "#2c2c3a", hair: "short", hairColor: "#5a3a22", extras: ["tie"], tag: "Chief of Staff", after: "Jim" },
  // The assistant (to the) regional manager: mustard shirt, brown tie, glasses, centre parting.
  COO: { skin: "#f0c8a0", shirt: "#d9b84a", tie: "#6b4423", pants: "#4a3b2a", hair: "part", hairColor: "#4a2e1a", extras: ["glasses", "tie"], tag: "COO", after: "Dwight" },
  // The accountant: neat dark hair, short beard, sweater vest.
  CFO: { skin: "#c98f62", shirt: "#e9eef6", jacket: "#5f6f52", pants: "#2d3b55", hair: "short", hairColor: "#1e1410", extras: ["beard", "cardigan"], tag: "CFO", after: "Oscar" },
  // Customer service and pop culture: long dark hair, bright pink top.
  CMO: { skin: "#a8704a", shirt: "#ff4f9a", pants: "#2b2140", hair: "long", hairColor: "#140c08", extras: [], tag: "CMO", after: "Kelly" },
  // The temp turned startup founder: dark hair, black jacket, earbuds.
  CTO: { skin: "#f0c8a0", shirt: "#e9e9e9", jacket: "#1f1f24", pants: "#1f1f24", hair: "spiky", hairColor: "#1b1410", extras: ["jacket", "headphones"], tag: "CTO", after: "Ryan" },
  // HR, in the annex: receding hair, grey sweater. Compliance is the job.
  "General Counsel": { skin: "#ecbf98", shirt: "#8d939c", pants: "#3b3f47", hair: "receding", hairColor: "#6b5a4a", extras: [], tag: "Counsel", after: "Toby" },
  // The warehouse foreman who runs the crew: short hair, beard, clipboard.
  "VA Lead": { skin: "#6e4430", shirt: "#3d6fa3", pants: "#2f2f2f", hair: "short", hairColor: "#141010", extras: ["beard", "clipboard"], tag: "VA Lead", after: "Darryl" },
  // The salesman who sings: red sweater over a shirt and tie.
  "Courts Lead": { skin: "#f2c8a2", shirt: "#f4f4f4", jacket: "#a3192c", tie: "#1d3a6b", pants: "#c9b28c", hair: "short", hairColor: "#6b4226", extras: ["cardigan", "tie"], tag: "Courts", after: "Andy" },
  // The regional manager: dark suit, red tie, big grin.
  Chair: { skin: "#f0c09a", shirt: "#f4f4f4", jacket: "#232a36", tie: "#b3202a", pants: "#232a36", hair: "short", hairColor: "#2a1a10", extras: ["jacket", "tie"], tag: "Chair", after: "Michael" },
  // The boss from head office: grey suit, greying hair.
  "Independent Director": { skin: "#e4b48c", shirt: "#f4f4f4", jacket: "#6b717c", tie: "#3b4a6b", pants: "#6b717c", hair: "grey", hairColor: "#8a8a8a", extras: ["jacket", "tie"], tag: "Director", after: "David" },
};

type Point = { x: number; y: number };

// The floor plan, in tiles. x runs down to the right on screen and y down to the left; the back walls stand
// along x = 0 and y = 0, and the front walls are cut away so the room can be seen into.
const SIZE = 12;
const WALL = 2.4;
// Floor tiles plus the back walls' height, in tiles, top to bottom on screen.
const TALL = SIZE + WALL;

// Rooms, each behind low walls with a doorway: the conference room in the back corner, the boss's glass
// office on the right, and the kitchen on the left. Everything else is the open office.
const CONF = { x1: 4.4, y1: 3.6 };
const BOSS = { x0: 8.4, y1: 4 };
const KITCHEN = { x1: 4.5, y0: 7.8 };
type Zone = "open" | "conf" | "boss" | "kitchen";
function zone(p: Point): Zone {
  if (p.x < CONF.x1 && p.y < CONF.y1) return "conf";
  if (p.x > BOSS.x0 && p.y < BOSS.y1) return "boss";
  if (p.x < KITCHEN.x1 && p.y > KITCHEN.y0) return "kitchen";
  return "open";
}
// Each room's doorway: a point just inside and one just outside.
const DOORS: Record<Exclude<Zone, "open">, { inside: Point; outside: Point }> = {
  conf: { inside: { x: 2.8, y: 3 }, outside: { x: 2.8, y: 4.2 } },
  boss: { inside: { x: 10.2, y: 3.4 }, outside: { x: 10.2, y: 4.7 } },
  kitchen: { inside: { x: 2.9, y: 8.5 }, outside: { x: 2.9, y: 7.1 } },
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

// Desks: where each teammate works, by the desk's back corner. The bullpen has two pairs of desks pushed
// together, accounting has its pod by the wall, the annex is at the front, and the boss has his own office.
// The director from head office has no desk: he waits in the conference room.
const DESKS: Record<string, Point> = {
  CFO: { x: 0.9, y: 4.6 },
  "Chief of Staff": { x: 4.9, y: 4.6 },
  COO: { x: 6.1, y: 4.6 },
  "Courts Lead": { x: 4.9, y: 6.4 },
  "VA Lead": { x: 6.1, y: 6.4 },
  CMO: { x: 5, y: 9.3 },
  CTO: { x: 6.4, y: 9.3 },
  "General Counsel": { x: 5, y: 11 },
  Chair: { x: 9.5, y: 1.5 },
};
// The rest of the accounting pod, with nobody at it.
const EMPTY_DESKS: Point[] = [
  { x: 0.9, y: 6.1 },
  { x: 2.3, y: 6.1 },
];
const HOME_SPOTS: Record<string, string> = { "Independent Director": "conf-a" };
const RECEPTION = { x: 8.6, y: 8.6 };
const ASSISTANT_SEAT = { x: 9.7, y: 8.45 };
// Where a teammate stands to talk with Ced, at either end of the reception desk.
const HUDDLE = [
  { x: 11.4, y: 9 },
  { x: 8.1, y: 9.9 },
];

type Spot = Point & { name: string; act: string; prop: string; sit?: boolean };
// Things to do when they're not working.
const SPOTS: Spot[] = [
  // Open office
  { name: "cooler", x: 4.9, y: 1.2, act: "sip", prop: "🥤" },
  { name: "copier", x: 6.9, y: 3, act: "wait", prop: "📄" },
  { name: "screen", x: 6.6, y: 1.2, act: "look", prop: "" },
  { name: "plant", x: 11.2, y: 5.2, act: "water", prop: "🚿" },
  { name: "stretch", x: 8.6, y: 6.6, act: "stretch", prop: "" },
  // Conference room
  { name: "whiteboard", x: 0.6, y: 2.2, act: "write", prop: "🖊️" },
  { name: "conf-a", x: 2, y: 0.85, act: "read", prop: "📰", sit: true },
  { name: "conf-b", x: 3.3, y: 0.85, act: "phone", prop: "📱", sit: true },
  // The boss's office
  { name: "window", x: 11.3, y: 1.1, act: "look", prop: "" },
  { name: "guest-a", x: 9.4, y: 3, act: "talk", prop: "", sit: true },
  { name: "guest-b", x: 11.2, y: 3, act: "talk", prop: "", sit: true },
  // Kitchen
  { name: "fridge", x: 1.3, y: 11.3, act: "fridge", prop: "🥪" },
  { name: "coffee", x: 1.2, y: 8.8, act: "sip", prop: "☕" },
  { name: "vending", x: 3.9, y: 11.2, act: "wait", prop: "🍫" },
  { name: "table-a", x: 2.5, y: 9.4, act: "eat", prop: "🍩", sit: true },
  { name: "table-b", x: 3.5, y: 9.4, act: "eat", prop: "🌶️", sit: true },
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
  const spot = spotAt(HOME_SPOTS[handle]);
  return { x: spot.x, y: spot.y };
}

function homeNext(handle: string): Next {
  return DESKS[handle]
    ? { mode: "desk", act: "type", prop: handle === "Chair" ? "☕" : "", sit: true, spot: "", ms: rand(15000, 30000) }
    : { mode: "act", act: "read", prop: "📰", sit: true, spot: HOME_SPOTS[handle], ms: rand(8000, 16000) };
}

// ---- Drawing in isometric view. `t` is a tile's width in pixels; a tile is t wide and t/2 deep on screen.

type Box = { x: number; y: number; w: number; d: number; h: number; z?: number; color: string; glass?: boolean };

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
    <g key={key} opacity={b.glass ? 0.45 : undefined}>
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
const DESK_PIECES: Piece[] = [...Object.values(DESKS), ...EMPTY_DESKS].flatMap(({ x, y }) => [
  // Chair back, behind the person.
  piece([{ x: x + 0.3, y: y - 0.75, w: 0.6, d: 0.2, h: 0.8, color: "#4a5568" }], x + y - 0.6),
  piece([
    { x, y, w: 1.2, d: 0.7, h: 0.72, color: WOOD },
    { x: x + 0.3, y: y + 0.08, w: 0.6, d: 0.08, h: 0.42, z: 0.72, color: "#1c2333" },
    { x: x + 0.95, y: y + 0.4, w: 0.12, d: 0.12, h: 0.14, z: 0.72, color: "#f1f3f8" },
  ]),
]);

// Little things on desks, from the show: a stapler set in jelly, a bobblehead, a stack of files, a cat
// figurine in accounting, and a mug on the boss's desk.
const TRINKETS: Piece[] = [
  piece([{ x: DESKS["Chief of Staff"].x + 0.08, y: DESKS["Chief of Staff"].y + 0.42, w: 0.24, d: 0.2, h: 0.16, z: 0.72, color: "#f2d43a", glass: true }]),
  piece([
    { x: DESKS.COO.x + 0.1, y: DESKS.COO.y + 0.45, w: 0.1, d: 0.1, h: 0.12, z: 0.72, color: "#4a3b2a" },
    { x: DESKS.COO.x + 0.07, y: DESKS.COO.y + 0.42, w: 0.16, d: 0.16, h: 0.14, z: 0.84, color: "#f0c8a0" },
  ]),
  piece([{ x: EMPTY_DESKS[1].x + 0.1, y: EMPTY_DESKS[1].y + 0.4, w: 0.12, d: 0.2, h: 0.18, z: 0.72, color: "#f4f4f4" }]),
  piece([{ x: EMPTY_DESKS[0].x + 0.1, y: EMPTY_DESKS[0].y + 0.35, w: 0.3, d: 0.25, h: 0.25, z: 0.72, color: "#e9e1cc" }]),
  piece([{ x: DESKS.Chair.x + 0.12, y: DESKS.Chair.y + 0.42, w: 0.14, d: 0.14, h: 0.16, z: 0.72, color: "#ffffff" }]),
];

const PIECES: Piece[] = [
  ...DESK_PIECES,
  ...TRINKETS,
  // Open office: water cooler and copier along the back, plants in the corners.
  piece([{ x: 4.6, y: 0.3, w: 0.5, d: 0.5, h: 0.9, color: "#e7ecf3" }, { x: 4.68, y: 0.38, w: 0.34, d: 0.34, h: 0.45, z: 0.9, color: "#8fd3ff" }]),
  piece([{ x: 6.2, y: 2.1, w: 0.9, d: 0.6, h: 0.85, color: "#d7dbe2" }, { x: 6.25, y: 2.15, w: 0.8, d: 0.5, h: 0.12, z: 0.85, color: "#9aa3b5" }]),
  plant(11.5, 4.6, 1),
  plant(8, 11.5, 0.9),
  // Reception desk, by the door.
  piece([{ x: RECEPTION.x, y: RECEPTION.y, w: 2.2, d: 0.8, h: 0.9, color: "#b98d5f" }, { x: RECEPTION.x + 0.8, y: RECEPTION.y + 0.1, w: 0.6, d: 0.08, h: 0.45, z: 0.9, color: "#1c2333" }, { x: RECEPTION.x + 0.2, y: RECEPTION.y + 0.4, w: 0.3, d: 0.25, h: 0.1, z: 0.9, color: "#2a2a2a" }]),
  piece([{ x: ASSISTANT_SEAT.x - 0.3, y: ASSISTANT_SEAT.y - 0.6, w: 0.6, d: 0.2, h: 0.8, color: "#4a5568" }], ASSISTANT_SEAT.x + ASSISTANT_SEAT.y - 0.5),
  // Conference room: a long table with chairs along the back.
  piece([{ x: 1.3, y: 1.2, w: 2.8, d: 1.1, h: 0.72, color: "#8a5a34" }]),
  piece([{ x: 1.7, y: 0.3, w: 0.6, d: 0.2, h: 0.8, color: "#2f3542" }], 1.7 + 0.6),
  piece([{ x: 3, y: 0.3, w: 0.6, d: 0.2, h: 0.8, color: "#2f3542" }], 3 + 0.6),
  // The boss's office: a bookcase and two guest chairs.
  piece([{ x: 11.4, y: 0.1, w: 0.5, d: 0.5, h: 1.6, color: "#6b4a2e" }]),
  piece([{ x: 9.1, y: 3.15, w: 0.6, d: 0.5, h: 0.45, color: "#5a6270" }]),
  piece([{ x: 10.9, y: 3.15, w: 0.6, d: 0.5, h: 0.45, color: "#5a6270" }]),
  // Kitchen: counter with a coffee machine and microwave along the wall, fridge and vending machine, a table.
  piece([
    { x: 0, y: 8.3, w: 0.7, d: 2.6, h: 0.9, color: "#e9edf3" },
    { x: 0.1, y: 8.5, w: 0.45, d: 0.45, h: 0.5, z: 0.9, color: "#c0392b" },
    { x: 0.08, y: 9.7, w: 0.5, d: 0.75, h: 0.38, z: 0.9, color: "#dfe4ec" },
  ], 0.35 + 9.6),
  piece([{ x: 0, y: 11.05, w: 0.8, d: 0.9, h: 2, color: "#f4f6fa" }]),
  piece([{ x: 3.4, y: 11.4, w: 0.9, d: 0.55, h: 1.8, color: "#2b3a67" }, { x: 3.5, y: 11.95, w: 0.6, d: 0.01, h: 1.1, z: 0.5, color: "#ffd166" }]),
  piece([{ x: 2.2, y: 9.6, w: 1.6, d: 1, h: 0.72, color: "#e0b07a" }, { x: 2.8, y: 9.95, w: 0.3, d: 0.3, h: 0.1, z: 0.72, color: "#f4a261" }]),
];

// Floor tile colours by room: grey-blue office carpet, a darker conference room, beige in the boss's
// office, kitchen lino, and the annex's slightly greener carpet at the front.
function tile(x: number, y: number): string {
  const odd = (x + y) % 2 === 1;
  const p = { x: x + 0.5, y: y + 0.5 };
  const z = zone(p);
  if (z === "kitchen") return odd ? "#dfe4ec" : "#c9d0dc";
  if (z === "conf") return odd ? "#6f7a88" : "#68737f";
  if (z === "boss") return odd ? "#b39b78" : "#ab9372";
  if (p.x > 4.5 && p.x < 8 && p.y > 8.6) return odd ? "#8e9a8c" : "#879384";
  return odd ? "#97a3ae" : "#909ca7";
}

// Low cut-away walls around the rooms, with gaps for the doorways. The conference room and the boss's office
// have glass walls, so whoever is inside can be seen.
const WALL_COLOR = "#e8dcc8";
const GLASS = "#bfe3f2";
const LOW_WALLS: Box[] = [
  { x: 0, y: CONF.y1 - 0.1, w: 2.4, d: 0.15, h: 1.1, color: GLASS, glass: true },
  { x: 3.2, y: CONF.y1 - 0.1, w: CONF.x1 - 3.2, d: 0.15, h: 1.1, color: GLASS, glass: true },
  { x: CONF.x1 - 0.1, y: 0, w: 0.15, d: CONF.y1, h: 1.1, color: GLASS, glass: true },
  { x: BOSS.x0 - 0.1, y: 0, w: 0.15, d: BOSS.y1, h: 1.1, color: GLASS, glass: true },
  { x: BOSS.x0, y: BOSS.y1 - 0.1, w: 1.4, d: 0.15, h: 1.1, color: GLASS, glass: true },
  { x: 10.6, y: BOSS.y1 - 0.1, w: SIZE - 10.6, d: 0.15, h: 1.1, color: GLASS, glass: true },
  { x: 0, y: KITCHEN.y0 - 0.1, w: 2.5, d: 0.15, h: 0.55, color: WALL_COLOR },
  { x: 3.3, y: KITCHEN.y0 - 0.1, w: KITCHEN.x1 - 3.3, d: 0.15, h: 0.55, color: WALL_COLOR },
  { x: KITCHEN.x1 - 0.1, y: KITCHEN.y0, w: 0.15, d: SIZE - KITCHEN.y0, h: 0.55, color: WALL_COLOR },
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
  // Each layer is only as big as what's on it: a phone browser may keep a full-size image of every layer
  // in memory, and dozens of room-sized ones were enough to crash the page.
  const layer = (z: number, children: React.ReactNode, key: string, boxes?: Box[]) => {
    let [x0, y0, x1, y1] = [0, 0, width, height];
    if (boxes) {
      const corners = boxes.flatMap((b) => {
        const z0 = b.z ?? 0;
        return [0, b.w].flatMap((dx) => [0, b.d].flatMap((dy) => [z0, z0 + b.h].map((h) => iso(t, b.x + dx, b.y + dy, h))));
      });
      x0 = Math.floor(Math.min(...corners.map((c) => c[0]))) - 1;
      x1 = Math.ceil(Math.max(...corners.map((c) => c[0]))) + 1;
      y0 = Math.floor(Math.min(...corners.map((c) => c[1]))) - 1;
      y1 = Math.ceil(Math.max(...corners.map((c) => c[1]))) + 1;
    }
    return (
      <svg key={key} className="layer" width={x1 - x0} height={y1 - y0} viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} style={{ zIndex: z, left: x0, top: y0 }} aria-hidden="true">
        {children}
      </svg>
    );
  };
  const depthZ = (depth: number) => Math.round(depth * 100);
  const wallTop = (x: number, y: number) => iso(t, x, y, WALL).join(",");
  const wallFoot = (x: number, y: number) => iso(t, x, y, 0).join(",");

  return (
    <div ref={scroller} className={`office-scroll ${night ? "night" : ""}`}>
      <div className="office" style={{ width, height, marginTop: gap }}>
        {layer(
          0,
          <>
            {/* Back walls: the right one along y = 0, the left one along x = 0, in office beige, with the rooms'
                sections painted to match them. */}
            <polygon points={`${wallFoot(0, 0)} ${wallFoot(SIZE, 0)} ${wallTop(SIZE, 0)} ${wallTop(0, 0)}`} fill="#ddd3bd" />
            <polygon points={`${wallFoot(0, 0)} ${wallFoot(CONF.x1, 0)} ${wallTop(CONF.x1, 0)} ${wallTop(0, 0)}`} fill="#c9cdd2" />
            <polygon points={`${wallFoot(BOSS.x0, 0)} ${wallFoot(SIZE, 0)} ${wallTop(SIZE, 0)} ${wallTop(BOSS.x0, 0)}`} fill="#e6d6b8" />
            <polygon points={`${wallFoot(0, 0)} ${wallFoot(0, SIZE)} ${wallTop(0, SIZE)} ${wallTop(0, 0)}`} fill="#cbc1aa" />
            <polygon points={`${wallFoot(0, 0)} ${wallFoot(0, CONF.y1)} ${wallTop(0, CONF.y1)} ${wallTop(0, 0)}`} fill="#b8bcc2" />
            <polygon points={`${wallFoot(0, KITCHEN.y0)} ${wallFoot(0, SIZE)} ${wallTop(0, SIZE)} ${wallTop(0, KITCHEN.y0)}`} fill="#cfe0e8" />
            {/* Skirting and the wall tops. */}
            <polyline points={`${wallFoot(0, SIZE)} ${wallFoot(0, 0)} ${wallFoot(SIZE, 0)}`} fill="none" stroke="#6b5a48" strokeWidth={t * 0.12} />
            <polyline points={`${wallTop(0, SIZE)} ${wallTop(0, 0)} ${wallTop(SIZE, 0)}`} fill="none" stroke="#f4efe6" strokeWidth={t * 0.18} strokeLinejoin="round" />
            {Array.from({ length: SIZE * SIZE }, (_, i) => {
              const x = i % SIZE;
              const y = Math.floor(i / SIZE);
              const corners = [iso(t, x, y), iso(t, x + 1, y), iso(t, x + 1, y + 1), iso(t, x, y + 1)];
              return <polygon key={i} points={corners.map((c) => c.join(",")).join(" ")} fill={tile(x, y)} stroke="rgba(0,0,0,0.08)" strokeWidth={0.6} />;
            })}
            {/* A doormat by reception, and the floor's edge. */}
            <polygon points={[iso(t, 11, 10.6), iso(t, 12, 10.6), iso(t, 12, 11.8), iso(t, 11, 11.8)].map((c) => c.join(",")).join(" ")} fill="#5a4634" opacity={0.85} />
            <polyline points={`${wallFoot(SIZE, 0)} ${wallFoot(SIZE, SIZE)} ${wallFoot(0, SIZE)}`} fill="none" stroke="#5a4634" strokeWidth={t * 0.25} />
          </>,
          "floor",
        )}

        {/* Things on the walls. */}
        <div className="on-wall whiteboard" style={onWall(t, "left", 0.5, 3.2, 0.9, 1.9)}>
          <span>First 10 agencies</span>
          <em />
          <em />
          <i />
        </div>
        <div className="on-wall screen" style={onWall(t, "right", 5.2, 8.1, 0.75, 2.15)}>
          {face}
        </div>
        <div className="on-wall window" style={onWall(t, "right", 8.8, 11.2, 0.9, 2)}>
          <span className="sun" />
        </div>
        <div className="on-wall room-sign" style={onWall(t, "left", 8.8, 10.8, 1.75, 2.15)}>
          Kitchen
        </div>
        <div className="on-wall room-sign" style={onWall(t, "right", 8.8, 11.2, 2.05, 2.35)}>
          Regional Manager
        </div>
        <div className="on-wall room-sign" style={onWall(t, "right", 0.8, 3.6, 2.05, 2.35)}>
          Conference Room
        </div>

        {LOW_WALLS.map((b, i) => layer(depthZ(b.x + b.w + b.y + b.d) - 30, boxFaces(t, b, "w"), `lw-${i}`, [b]))}
        {PIECES.map((p, i) => layer(depthZ(p.depth), p.boxes.map((b, k) => boxFaces(t, b, String(k))), `p-${i}`, p.boxes))}

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
    ["--jacket" as string]: look.jacket ?? look.shirt,
    ["--tie" as string]: look.tie ?? "#c62828",
  };
  const classes = ["bot", `m-${mode}`, `act-${act}`, sit ? "sit" : "", talking ? "talking" : "", listening ? "listening" : "", focused ? "focused" : "", `hair-${look.hair}`, ...look.extras.map((e) => `x-${e}`)];
  return (
    <button className={classes.filter(Boolean).join(" ")} style={style} onClick={() => onTap(handle)} aria-label={`Talk to ${look.tag}`} title={`${look.tag}, styled after ${look.after}`}>
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
