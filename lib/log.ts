import { github } from "./tools";

// The shared KRO5 log: one GitHub issue whose comments are short summaries posted by Ced's project threads,
// team routines and KRO5 itself, so KRO5 knows what was decided in places it can't read directly.
// It lives in a private repo because it holds business decisions.
export const LOG_REPO = "cedricoruga-debug/va-agency-saas";
export const LOG_LABEL = "kro5-log";

const PER_PAGE = 100;
let cachedIssue: number | null = null;

async function findLogIssue(): Promise<number | null> {
  if (cachedIssue) return cachedIssue;
  const found: any[] = await github(`/repos/${LOG_REPO}/issues?labels=${LOG_LABEL}&state=open&per_page=1`);
  if (found[0]) cachedIssue = found[0].number;
  return cachedIssue;
}

async function logIssueForWriting(): Promise<number> {
  const existing = await findLogIssue();
  if (existing) return existing;
  const issue = await github(`/repos/${LOG_REPO}/issues`, {
    method: "POST",
    body: JSON.stringify({
      title: "KRO5 log",
      labels: [LOG_LABEL],
      body: "Shared log for KRO5. Project threads, team routines and the KRO5 voice assistant add a short comment here when they decide or finish something, so KRO5 can answer questions about it. See docs/kro5-log.md in Kro5-agent.",
    }),
  });
  return (cachedIssue = issue.number);
}

export type LogEntry = { at: string; by: string; text: string; url: string };

// The newest entries first. With a query, only entries containing every word of it (from the latest 200).
export async function readLog(limit: number, query: string): Promise<{ entries: LogEntry[]; url?: string }> {
  const number = await findLogIssue();
  if (!number) return { entries: [] };
  const issue = await github(`/repos/${LOG_REPO}/issues/${number}`);
  const lastPage = Math.max(1, Math.ceil(issue.comments / PER_PAGE));
  const pages = lastPage > 1 ? [lastPage - 1, lastPage] : [lastPage];
  const comments = (
    await Promise.all(pages.map((page) => github(`/repos/${LOG_REPO}/issues/${number}/comments?per_page=${PER_PAGE}&page=${page}`)))
  ).flat();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const entries = comments
    .reverse()
    .filter((c: any) => words.every((w) => String(c.body).toLowerCase().includes(w)))
    .slice(0, limit)
    .map((c: any) => ({ at: c.created_at, by: c.user?.login ?? "", text: String(c.body).slice(0, 1500), url: c.html_url }));
  return { entries, url: issue.html_url };
}

// Records something KRO5 did. Never fails the action it describes: the action already happened.
export async function addToLog(text: string): Promise<void> {
  try {
    const number = await logIssueForWriting();
    await github(`/repos/${LOG_REPO}/issues/${number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: `**From:** KRO5 voice\n${text}` }),
    });
  } catch (err) {
    console.error("Couldn't write to the KRO5 log", err);
  }
}
