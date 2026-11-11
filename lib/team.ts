// Ced's KRO5 team. They work from the KRO5 Project docs through the KRO5 Voice Request routine (ask_team);
// the app shows them as characters in an office that Ced can tap to talk to.
export type Teammate = { handle: string; name: string; does: string };

export const team: Teammate[] = [
  { handle: "Chief of Staff", name: "Chief of Staff", does: "Daily brief, priorities, follow-ups" },
  { handle: "CFO", name: "CFO", does: "Pricing, cash, costs, forecasts" },
  { handle: "CMO", name: "CMO", does: "Outreach, content, positioning" },
  { handle: "COO", name: "COO", does: "Operations, processes, delivery" },
  { handle: "CTO", name: "CTO / CPO", does: "Product, tech plans, build briefs" },
  { handle: "General Counsel", name: "General Counsel", does: "Contracts, privacy, compliance" },
  { handle: "VA Lead", name: "VA Lead", does: "KRO5 for VA Agencies product and agencies" },
  { handle: "Courts Lead", name: "Courts Lead", does: "KRO5 Courts" },
  { handle: "Chair", name: "Chair", does: "Board view and big decisions" },
  { handle: "Independent Director", name: "Independent Director", does: "Outside challenge on plans" },
];

// Ced talks to their assistant, KRO5. In a reply she can bring a teammate in: "[[CFO]]" starts the CFO's
// lines and "[[KRO5]]" hands back to her. The app voices and animates each part as its speaker.
export const ASSISTANT = "KRO5";
const CUE = /\[\[([^\]\n]{1,40})\]\]/g;

// The handle a cue names, or null when it names nobody in the office.
export function castHandle(name: string): string | null {
  const n = name.trim().replace(/^@/, "").toLowerCase();
  if (n === ASSISTANT.toLowerCase()) return ASSISTANT;
  return team.find((t) => t.handle.toLowerCase() === n || t.name.toLowerCase() === n)?.handle ?? null;
}

export type Part = { who: string; text: string };

// Splits a whole reply into who said what. Text before any cue is the assistant's.
export function splitCast(text: string): Part[] {
  const parts: Part[] = [];
  let who = ASSISTANT;
  let at = 0;
  const add = (piece: string) => {
    const last = parts[parts.length - 1];
    if (last && last.who === who) last.text += piece;
    else if (piece.trim()) parts.push({ who, text: piece });
  };
  for (const m of text.matchAll(CUE)) {
    add(text.slice(at, m.index));
    who = castHandle(m[1]) ?? who;
    at = m.index! + m[0].length;
  }
  add(text.slice(at));
  return parts.map((p) => ({ ...p, text: p.text.replace(/\s+/g, " ").trim() })).filter((p) => p.text);
}

// The reply as plain words, for Siri and memory, which don't know about the office.
export function stripCast(text: string): string {
  return text.replace(CUE, " ").replace(/\s+/g, " ").trim();
}

// Follows a streaming reply and hands out who said each new piece, holding back a cue that hasn't
// finished arriving so "[[CF" is never spoken.
export class CastStream {
  who = ASSISTANT;
  private pending = "";

  feed(delta: string): Part[] {
    this.pending += delta;
    const out: Part[] = [];
    for (;;) {
      const open = this.pending.indexOf("[[");
      if (open === -1) {
        // A lone "[" at the end may be the start of a cue.
        const keep = this.pending.endsWith("[") ? 1 : 0;
        this.emit(out, this.pending.slice(0, this.pending.length - keep));
        this.pending = this.pending.slice(this.pending.length - keep);
        return out;
      }
      this.emit(out, this.pending.slice(0, open));
      const close = this.pending.indexOf("]]", open);
      if (close === -1) {
        this.pending = this.pending.slice(open);
        // Not a cue after all: let it through rather than holding the reply forever.
        if (this.pending.length > 44) {
          this.emit(out, this.pending);
          this.pending = "";
        }
        return out;
      }
      const handle = castHandle(this.pending.slice(open + 2, close));
      if (handle) this.who = handle;
      else this.emit(out, this.pending.slice(open, close + 2));
      this.pending = this.pending.slice(close + 2);
    }
  }

  end(): Part[] {
    const out: Part[] = [];
    this.emit(out, this.pending);
    this.pending = "";
    return out;
  }

  private emit(out: Part[], text: string) {
    if (text) out.push({ who: this.who, text });
  }
}
