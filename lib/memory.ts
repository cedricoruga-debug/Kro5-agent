import { LOG_REPO } from "./log";
import { github } from "./tools";

// KRO5's memory across days: one GitHub issue whose comments are the facts and preferences Ced wants
// KRO5 to keep ("I prefer calls after 2pm", "the Acme demo is on Friday"). It sits next to the KRO5 log
// in the private repo, because Kro5-agent is public. Ced can read or edit it there too.
const MEMORY_LABEL = "kro5-memory";
const PER_PAGE = 100;
// What a new conversation starts with: the newest facts, kept short so every reply stays quick.
const MAX_FACTS = 60;
const MAX_FACT_CHARS = 300;

let cachedIssue: number | null = null;

async function findMemoryIssue(create: boolean): Promise<number | null> {
  if (cachedIssue) return cachedIssue;
  const found: any[] = await github(`/repos/${LOG_REPO}/issues?labels=${MEMORY_LABEL}&state=open&per_page=1`);
  if (found[0]) return (cachedIssue = found[0].number);
  if (!create) return null;
  const issue = await github(`/repos/${LOG_REPO}/issues`, {
    method: "POST",
    body: JSON.stringify({
      title: "KRO5 memory",
      labels: [MEMORY_LABEL],
      body: "What the KRO5 voice assistant remembers about Ced, one fact per comment. KRO5 reads these at the start of every conversation. Delete a comment here, or say \"forget …\" to KRO5, to make it forget.",
    }),
  });
  return (cachedIssue = issue.number);
}

export type Fact = { id: number; at: string; text: string };

async function allFacts(): Promise<Fact[]> {
  const number = await findMemoryIssue(false);
  if (!number) return [];
  const issue = await github(`/repos/${LOG_REPO}/issues/${number}`);
  const lastPage = Math.max(1, Math.ceil(issue.comments / PER_PAGE));
  const comments: any[] = await github(`/repos/${LOG_REPO}/issues/${number}/comments?per_page=${PER_PAGE}&page=${lastPage}`);
  // Newest first.
  return comments.reverse().map((c) => ({ id: c.id, at: c.created_at, text: String(c.body).slice(0, MAX_FACT_CHARS) }));
}

export async function remember(fact: string): Promise<Fact> {
  const number = await findMemoryIssue(true);
  const comment = await github(`/repos/${LOG_REPO}/issues/${number}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: fact.trim().slice(0, MAX_FACT_CHARS) }),
  });
  return { id: comment.id, at: comment.created_at, text: comment.body };
}

// Forgets every fact that contains all the words of the query. Returns what was forgotten.
export async function forget(query: string): Promise<string[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const matches = (await allFacts()).filter((f) => words.every((w) => f.text.toLowerCase().includes(w)));
  await Promise.all(matches.map((f) => github(`/repos/${LOG_REPO}/issues/comments/${f.id}`, { method: "DELETE" })));
  return matches.map((f) => f.text);
}

export type RecentChat = { at: string; asked: string; reply: string };

// The note a new conversation starts with: what KRO5 remembers, and what Ced asked lately on their phone.
// Never fails the reply: without memory KRO5 still answers.
export async function memoryNote(recent: RecentChat[] = []): Promise<string> {
  let facts: Fact[] = [];
  try {
    facts = (await allFacts()).slice(0, MAX_FACTS);
  } catch (err) {
    console.error("Couldn't read KRO5 memory", err);
  }
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric" });
  const parts: string[] = [];
  if (facts.length) parts.push(`What you remember about Ced (newest first):\n${facts.map((f) => `- ${f.text} (${day(f.at)})`).join("\n")}`);
  if (recent.length) {
    parts.push(
      `Ced's last conversations with you on their phone (newest first):\n${recent
        .map((r) => `- ${day(r.at)}: Ced asked "${r.asked.slice(0, 200)}". You said: ${r.reply.slice(0, 300)}`)
        .join("\n")}`,
    );
  }
  return parts.length ? `(${parts.join("\n\n")})` : "";
}
