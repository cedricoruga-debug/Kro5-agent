// Ced's calendar, read-only, from its private iCal link (KRO5_CALENDAR_ICS_URL). Google Calendar gives one
// under Settings > your calendar > Integrate calendar > "Secret address in iCal format". No sign-in or
// Google app is needed, and KRO5 can't change anything through it.

export type CalendarEvent = { title: string; start: string; end: string; allDay: boolean; location?: string };

const DAY_MS = 24 * 60 * 60 * 1000;
// Repeating events are expanded up to this many times, so a daily event from years ago still shows today.
const MAX_REPEATS = 5000;

type Raw = Record<string, { value: string; params: Record<string, string> }[]>;

// iCal folds long lines: a line starting with a space or tab carries on the one before.
function parse(ics: string): Raw[] {
  const lines = ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const events: Raw[] = [];
  let current: Raw | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") current = {};
    else if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
    } else if (current) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const [name, ...paramParts] = line.slice(0, colon).split(";");
      const params = Object.fromEntries(paramParts.map((p) => p.split("=") as [string, string]));
      (current[name.toUpperCase()] ??= []).push({ value: line.slice(colon + 1), params });
    }
  }
  return events;
}

const unescape = (text: string) => text.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

// The UTC offset of a time zone at a moment, in ms (Asia/Manila is +8h).
function offsetMs(timeZone: string, at: number): number {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(at)
        .map((p) => [p.type, p.value]),
    );
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - at;
  } catch {
    return 8 * 60 * 60 * 1000;
  }
}

// "20261022T140000Z", "20261022T140000" with a TZID, or "20261022" for an all-day event. All-day dates are
// placed at midnight Manila time, where Ced lives.
function toTime(prop: { value: string; params: Record<string, string> }): { at: number; allDay: boolean; zone?: string } {
  const m = prop.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return { at: NaN, allDay: false };
  const [, y, mo, d, h, mi, s, z] = m;
  const allDay = h === undefined;
  const wall = Date.UTC(+y, +mo - 1, +d, +(h ?? 0), +(mi ?? 0), +(s ?? 0));
  if (z) return { at: wall, allDay };
  const zone = allDay ? "Asia/Manila" : prop.params.TZID?.replace(/^"|"$/g, "") || "Asia/Manila";
  // Two passes get the offset right on a daylight-saving changeover day.
  const guess = wall - offsetMs(zone, wall);
  return { at: wall - offsetMs(zone, guess), allDay, zone };
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// Start times of a repeating event inside [from, to). Covers the common rules: daily, weekly (with days),
// monthly on the same date and yearly, with INTERVAL, COUNT and UNTIL.
function repeats(start: number, rule: string, from: number, to: number): number[] {
  const r = Object.fromEntries(rule.split(";").map((p) => p.split("=") as [string, string]));
  const interval = Math.max(1, Number(r.INTERVAL) || 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? toTime({ value: r.UNTIL, params: {} }).at : Infinity;
  const days = r.BYDAY ? r.BYDAY.split(",").map((d) => WEEKDAYS.indexOf(d.slice(-2))) : null;
  const out: number[] = [];
  let seen = 0;
  for (let i = 0; i < MAX_REPEATS && seen < count; i++) {
    const base = new Date(start);
    let candidates: number[];
    if (r.FREQ === "DAILY") candidates = [start + i * interval * DAY_MS];
    else if (r.FREQ === "WEEKLY") {
      const weekStart = start + i * interval * 7 * DAY_MS;
      candidates = days
        ? days.map((day) => weekStart + ((day - new Date(start).getUTCDay() + 7) % 7) * DAY_MS).sort((a, b) => a - b)
        : [weekStart];
    } else if (r.FREQ === "MONTHLY") {
      const d = new Date(base);
      d.setUTCMonth(base.getUTCMonth() + i * interval);
      candidates = d.getUTCDate() === base.getUTCDate() ? [d.getTime()] : [];
    } else if (r.FREQ === "YEARLY") {
      const d = new Date(base);
      d.setUTCFullYear(base.getUTCFullYear() + i * interval);
      candidates = [d.getTime()];
    } else return [start];
    for (const at of candidates) {
      if (at > until || seen >= count) return out;
      seen++;
      if (at >= to) return out;
      if (at >= from) out.push(at);
    }
  }
  return out;
}

export async function calendarEvents(fromDays: number, toDays: number): Promise<CalendarEvent[]> {
  const url = process.env.KRO5_CALENDAR_ICS_URL;
  if (!url) throw new Error("No calendar connected yet. Setup is in docs/calendar.md.");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Calendar ${res.status}`);
  const raw = parse(await res.text());

  // Today, midnight in Manila, is day 0.
  const manilaMidnight = Math.floor((Date.now() + 8 * 3600000) / DAY_MS) * DAY_MS - 8 * 3600000;
  const from = manilaMidnight + fromDays * DAY_MS;
  const to = manilaMidnight + toDays * DAY_MS;

  // A changed or cancelled single occurrence of a repeating event comes as its own entry with RECURRENCE-ID.
  const moved = new Set(
    raw.filter((e) => e["RECURRENCE-ID"]).map((e) => `${e.UID?.[0]?.value}|${toTime(e["RECURRENCE-ID"][0]).at}`),
  );

  const events: CalendarEvent[] = [];
  for (const e of raw) {
    if (!e.DTSTART || e.STATUS?.[0]?.value === "CANCELLED") continue;
    const start = toTime(e.DTSTART[0]);
    if (Number.isNaN(start.at)) continue;
    const end = e.DTEND ? toTime(e.DTEND[0]).at : start.at;
    const length = Math.max(start.allDay ? DAY_MS : 0, end - start.at);
    const uid = e.UID?.[0]?.value;
    const skipped = new Set(
      (e.EXDATE ?? []).flatMap((x) => x.value.split(",").map((v) => toTime({ value: v, params: x.params }).at)),
    );
    const rule = e.RRULE?.[0]?.value;
    // Repeats keep their wall-clock time in their own time zone across daylight-saving changes.
    const local = (at: number) => (start.zone && !start.allDay ? at + offsetMs(start.zone, start.at) - offsetMs(start.zone, at) : at);
    const starts = rule && !e["RECURRENCE-ID"] ? repeats(start.at, rule, from - length - DAY_MS, to + DAY_MS).map(local) : [start.at];
    for (const at of starts) {
      if (at + length <= from || at >= to) continue;
      if (rule && !e["RECURRENCE-ID"] && (skipped.has(at) || moved.has(`${uid}|${at}`))) continue;
      events.push({
        title: unescape(e.SUMMARY?.[0]?.value ?? "Busy"),
        start: new Date(at).toISOString(),
        end: new Date(at + length).toISOString(),
        allDay: start.allDay,
        location: e.LOCATION?.[0]?.value ? unescape(e.LOCATION[0].value).slice(0, 120) : undefined,
      });
    }
  }
  return events.sort((a, b) => a.start.localeCompare(b.start)).slice(0, 50);
}
