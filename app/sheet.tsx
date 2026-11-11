"use client";

import { useRef, useState } from "react";

// The dashboard hangs from the top of the screen: a thin strip shows while Ced talks, and a drag down
// (or a tap) pulls the whole thing open. Dragging it back up, or tapping the handle, puts it away.
const CLOSED_PX = 58;
const OPEN_SHARE = 0.86;

export function TopSheet({ open, onOpen, children }: { open: boolean; onOpen: (open: boolean) => void; children: React.ReactNode }) {
  const [height, setHeight] = useState<number | null>(null);
  const drag = useRef<{ y: number; from: number; at: number; moved: boolean } | null>(null);
  const body = useRef<HTMLDivElement>(null);

  const openPx = () => window.innerHeight * OPEN_SHARE;
  const closedPx = () => CLOSED_PX + (body.current ? parseFloat(getComputedStyle(body.current).paddingTop) || 0 : 0);

  function down(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, from: open ? openPx() : closedPx(), at: performance.now(), moved: false };
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) > 6) d.moved = true;
    if (d.moved) setHeight(Math.min(openPx(), Math.max(closedPx(), d.from + dy)));
  }

  function up(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      setHeight(null);
      return onOpen(!open);
    }
    const dy = e.clientY - d.y;
    // A quick flick counts even if it's short.
    const speed = dy / Math.max(1, performance.now() - d.at);
    const shown = d.from + dy;
    const next = Math.abs(speed) > 0.5 ? speed > 0 : shown > (openPx() + closedPx()) / 2;
    setHeight(null);
    onOpen(next);
  }

  if (!open && body.current) body.current.scrollTop = 0;
  const grab = { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up };

  return (
    <>
      {open && <div className="sheet-shade" onClick={() => onOpen(false)} />}
      <div
        className={`top-sheet ${open ? "open" : ""} ${height !== null ? "dragging" : ""}`}
        style={height !== null ? { height } : undefined}
      >
        <div ref={body} className="sheet-body">
          {children}
        </div>
        {/* Closed, the whole strip is something to pull; open, only the handle is, so the dashboard scrolls. */}
        {!open && <div className="sheet-grab" {...grab} aria-label="Open the dashboard" role="button" />}
        <div className="sheet-handle" {...grab} role="button" aria-label={open ? "Close the dashboard" : "Open the dashboard"}>
          <span />
        </div>
      </div>
    </>
  );
}
