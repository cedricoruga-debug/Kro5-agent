// KRO5's scheduled routines. Their runs can't be read back through an API, so the dashboard shows
// when each runs next and links to claude.ai/code, where the results land.
export type Routine = { name: string; what: string; times: string[] };

export const routines: Routine[] = [
  { name: "Daily Brief", what: "Your morning brief from the Chief of Staff", times: ["07:46"] },
  { name: "KRO5 Watch", what: "Deploys, errors, leads and PRs; pings only when needed", times: ["10:13", "14:13", "18:13"] },
];

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8 all year, no daylight saving

// Next weekday run in Manila time, as a real Date.
export function nextRun(routine: Routine, now = new Date()): Date {
  for (let day = 0; day < 8; day++) {
    for (const time of routine.times) {
      const [h, m] = time.split(":").map(Number);
      const manila = new Date(now.getTime() + MANILA_OFFSET_MS);
      manila.setUTCDate(manila.getUTCDate() + day);
      manila.setUTCHours(h, m, 0, 0);
      const weekday = manila.getUTCDay();
      const at = new Date(manila.getTime() - MANILA_OFFSET_MS);
      if (weekday !== 0 && weekday !== 6 && at > now) return at;
    }
  }
  throw new Error("No run in the next week");
}
