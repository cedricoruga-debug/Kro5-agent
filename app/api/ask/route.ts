import { runAgent } from "@/lib/agent";
import { checkShortcutToken } from "@/lib/auth";

export const maxDuration = 120;

// For the "Hey Siri, KRO5" Shortcut: one question in, one plain-text answer out for Siri to read aloud.
// Siri mode is read-only (see lib/agent.ts).
const say = (text: string, status = 200) =>
  new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function POST(request: Request) {
  if (!checkShortcutToken(request)) return say("KRO5 didn't recognise this Shortcut's key.", 401);

  let text = "";
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
  } catch {}
  if (!text) return say("I didn't catch that. Try again.");

  try {
    const { reply } = await runAgent([{ role: "user", content: text }], { siri: true });
    return say(reply);
  } catch (err) {
    console.error(err);
    return say("KRO5 hit an error talking to Claude. Try again.", 502);
  }
}
