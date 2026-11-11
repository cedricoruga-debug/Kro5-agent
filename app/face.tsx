"use client";

import { useEffect, useRef } from "react";
import { levels } from "./voice";

type Status = "idle" | "listening" | "thinking" | "speaking";

type Trace = { points: [number, number][]; lengths: number[]; total: number };
type Pulse = { trace: Trace; at: number; speed: number; inward: boolean };

const ACCENT = "124, 240, 200";
const LISTEN = "255, 120, 120";
const CHIP_W = 92;
const CHIP_H = 56;

// KRO5's face: a circuit board around a chip with its name. Signals flow out of the chip while KRO5
// talks, into it while it listens, circle it while it thinks, and drift slowly when idle.
export function Face({ status, onTap }: { status: Status; onTap: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let traces: Trace[] = [];
    let pulses: Pulse[] = [];
    let glow = 0;
    let spin = 0;
    let frame = 0;
    let last = performance.now();

    const layout = () => {
      const ratio = window.devicePixelRatio || 1;
      width = el.clientWidth;
      height = el.clientHeight;
      el.width = Math.round(width * ratio);
      el.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      traces = board(width, height);
      pulses = [];
    };
    const resize = new ResizeObserver(layout);
    resize.observe(el);
    layout();

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const state = statusRef.current;
      const color = state === "listening" ? LISTEN : ACCENT;
      // How loud things are right now: the mic while listening, a lively stand-in while speaking.
      const level =
        state === "listening"
          ? Math.min(1, levels.mic * 8)
          : state === "speaking"
            ? 0.45 + 0.35 * Math.abs(Math.sin(now / 90) * Math.sin(now / 237))
            : state === "thinking"
              ? 0.35
              : 0.08;
      glow += (level - glow) * Math.min(1, dt * 10);
      spin += dt * (state === "thinking" ? 3 : 0.4);

      const rate = calm ? 0.3 : { idle: 0.6, listening: 4 + glow * 30, thinking: 8, speaking: 6 + glow * 26 }[state];
      if (traces.length && Math.random() < rate * dt) {
        const inward = state === "listening" || (state === "thinking" && Math.random() < 0.5);
        const trace = traces[Math.floor(Math.random() * traces.length)];
        pulses.push({ trace, at: inward ? trace.total : 0, speed: (state === "idle" ? 60 : 160) + Math.random() * 80, inward });
      }

      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(${color}, ${0.14 + glow * 0.12})`;
      ctx.fillStyle = `rgba(${color}, ${0.25 + glow * 0.2})`;
      for (const trace of traces) {
        ctx.beginPath();
        trace.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        const [ex, ey] = trace.points[trace.points.length - 1];
        ctx.beginPath();
        ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      pulses = pulses.filter((p) => {
        p.at += (p.inward ? -1 : 1) * p.speed * dt;
        if (p.at < 0 || p.at > p.trace.total) return false;
        for (let k = 0; k < 6; k++) {
          const [x, y] = pointAt(p.trace, p.at - (p.inward ? -1 : 1) * k * 5);
          ctx.beginPath();
          ctx.fillStyle = `rgba(${color}, ${(1 - k / 6) * 0.9})`;
          ctx.arc(x, y, 2.6 - k * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
        return true;
      });

      if (state === "thinking") {
        ctx.strokeStyle = `rgba(${color}, 0.7)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, CHIP_W * 0.75, CHIP_H * 0.95, 0, spin, spin + Math.PI * 0.6);
        ctx.stroke();
      }

      ctx.shadowColor = `rgba(${color}, 0.9)`;
      ctx.shadowBlur = 8 + glow * 30;
      ctx.fillStyle = "#10141b";
      ctx.strokeStyle = `rgba(${color}, ${0.6 + glow * 0.4})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(cx - CHIP_W / 2, cy - CHIP_H / 2, CHIP_W, CHIP_H, 8);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(${color}, ${0.75 + glow * 0.25})`;
      ctx.font = "600 20px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("KRO5", cx, cy + 1);

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
    };
  }, []);

  return <canvas ref={canvas} className={`face ${status}`} onClick={onTap} aria-hidden="true" />;
}

// Traces leave the chip's edges and run outward in straight runs with 45° turns, like a circuit board.
function board(width: number, height: number): Trace[] {
  const cx = width / 2;
  const cy = height / 2;
  const traces: Trace[] = [];
  const count = Math.round(Math.min(40, Math.max(16, (width * height) / 4000)));
  for (let i = 0; i < count; i++) {
    const side = i % 4;
    const along = (Math.floor(i / 4) + 0.5) / Math.ceil(count / 4) - 0.5;
    let x = side % 2 === 0 ? cx + along * CHIP_W * 0.9 : cx + (side === 1 ? 1 : -1) * CHIP_W / 2;
    let y = side % 2 === 0 ? cy + (side === 0 ? -1 : 1) * CHIP_H / 2 : cy + along * CHIP_H * 0.9;
    let angle = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][side];
    const points: [number, number][] = [[x, y]];
    let steps = 0;
    while (x > 0 && x < width && y > 0 && y < height && steps++ < 12) {
      const run = 14 + Math.random() * 46;
      x += Math.cos(angle) * run;
      y += Math.sin(angle) * run;
      points.push([Math.max(4, Math.min(width - 4, x)), Math.max(4, Math.min(height - 4, y))]);
      const turn = Math.random();
      if (turn < 0.3) angle += Math.PI / 4;
      else if (turn < 0.6) angle -= Math.PI / 4;
      // Keep heading away from the chip.
      const away = Math.atan2(y - cy, x - cx);
      if (Math.cos(angle - away) < 0.2) angle = Math.round(away / (Math.PI / 4)) * (Math.PI / 4);
    }
    const lengths = [0];
    for (let k = 1; k < points.length; k++) {
      lengths.push(lengths[k - 1] + Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]));
    }
    traces.push({ points, lengths, total: lengths[lengths.length - 1] });
  }
  return traces;
}

function pointAt(trace: Trace, at: number): [number, number] {
  const d = Math.max(0, Math.min(trace.total, at));
  let k = 1;
  while (k < trace.lengths.length - 1 && trace.lengths[k] < d) k++;
  const span = trace.lengths[k] - trace.lengths[k - 1] || 1;
  const f = (d - trace.lengths[k - 1]) / span;
  const [x0, y0] = trace.points[k - 1];
  const [x1, y1] = trace.points[k];
  return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
}
