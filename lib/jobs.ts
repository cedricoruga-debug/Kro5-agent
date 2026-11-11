import { addToLog, readLog, type LogEntry } from "./log";
import { env } from "./tools";

// Work KRO5 can't do with its own tools goes to a full Claude Code session: the KRO5 Voice Request routine.
// Each run gets a job number (K5-7QX2). KRO5 logs the start in the KRO5 log, and the routine posts its
// result there with the same number, so KRO5 and the dashboard can tell how a job is going.

// team: an answer from the KRO5 team personas (ask_team). look: read-only work. do: work that changes something.
export type JobMode = "team" | "look" | "do";
export type JobStatus = "running" | "done" | "waiting on Ced" | "no word";

export type Job = {
  id: string;
  mode: JobMode;
  request: string;
  at: string;
  status: JobStatus;
  // The session doing the job, to watch or reply to it.
  url?: string;
  // The routine's latest log entry for this job.
  result?: string;
  resultAt?: string;
};

const JOB_ID = /\bK5-[A-Z0-9]{4}\b/;
// A job with no word after this long has probably failed to log, rather than still working.
const QUIET_MS = 2 * 60 * 60 * 1000;

function newJobId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `K5-${Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")}`;
}

// Fires the routine with the job number and mode on the first line, then Ced's request.
export async function startJob(mode: JobMode, request: string): Promise<{ id: string; url: string } | { error: string }> {
  const id = newJobId();
  const res = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${env("KRO5_ROUTINE_ID")}/fire`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("KRO5_ROUTINE_TOKEN")}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "experimental-cc-routine-2026-04-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: `Job ${id} · mode: ${mode}\n\n${request}` }),
  });
  if (res.status === 429) return { error: "The routine is rate limited (30 jobs an hour). Try again later." };
  if (!res.ok) throw new Error(`Routine ${res.status}: ${(await res.text()).slice(0, 300)}`);
  // The fire endpoint answers { type: "routine_fire", claude_code_session_id, claude_code_session_url }.
  const data = await res.json();
  const started = mode === "team" ? `Asked the team (job ${id}): ${request}` : `Started job ${id} (${mode}): ${request}`;
  await addToLog(`${started}\nSession: ${data.claude_code_session_url}`);
  return { id, url: data.claude_code_session_url };
}

const START = /^\*\*From:\*\* KRO5 voice\r?\n(?:Asked the team(?: \(job (K5-\w{4})\))?|Started job (K5-\w{4}) \((look|do)\)):\s*([\s\S]*?)(?:\r?\nSession:\s*(https:\/\/\S+))?\s*$/;

function waitingOn(text: string): string | undefined {
  return text.match(/Waiting on Ced:\**\s*(.+)/i)?.[1]?.trim();
}

// Jobs started in the last `days`, newest first, each with its status from the routine's log entries.
export async function recentJobs(days: number): Promise<Job[]> {
  const { entries } = await readLog(200, "");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const jobs: Job[] = [];
  const results = new Map<string, LogEntry>();
  // Entries come newest first, so the first result seen for a job is its latest.
  for (const entry of entries) {
    const start = entry.text.match(START);
    if (start) {
      if (entry.at < since) continue;
      const [, teamId, jobId, mode, request, url] = start;
      // Team requests from before job numbers have no id; they show but can't be matched to a result.
      jobs.push({ id: teamId ?? jobId ?? "", mode: (mode as JobMode) ?? "team", request: request.trim().slice(0, 300), at: entry.at, status: "running", ...(url ? { url } : {}) });
      continue;
    }
    const id = entry.text.match(JOB_ID)?.[0];
    if (id && !results.has(id)) results.set(id, entry);
  }
  return jobs.map((job) => {
    const result = job.id ? results.get(job.id) : undefined;
    if (result) {
      const waiting = waitingOn(result.text);
      const status: JobStatus = waiting && !/^nothing\b/i.test(waiting) ? "waiting on Ced" : "done";
      return { ...job, status, result: result.text.slice(0, 800), resultAt: result.at };
    }
    return Date.now() - Date.parse(job.at) > QUIET_MS ? { ...job, status: "no word" as const } : job;
  });
}
