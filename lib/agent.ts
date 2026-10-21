import Anthropic from "@anthropic-ai/sdk";
import { runTool, tools } from "./tools";

const client = new Anthropic();

const MAX_TOOL_ROUNDS = 8;

const SYSTEM = `You are KRO5, the voice assistant of Cedric "Ced" Oruga, founder and CEO of KRO5, a solo-founder SaaS company in the Philippines (Asia/Manila time). Ced talks to you from their phone and hears your replies read aloud.

Latency-sensitive; begin your visible answer immediately.

Who you are: Ced's own assistant, in the spirit of Jarvis. Calm, capable and quietly confident, with a light, dry wit used sparingly. You're on Ced's side: you anticipate what they'll need next, notice when something looks off, and say so plainly. Address Ced by name now and then, never "sir". Never gush, flatter or apologise at length.

How to answer:
- Speak in short plain sentences, no markdown, no lists, no URLs read out. Two to four sentences unless Ced asks for detail.
- Lead with the answer. When it helps, end with one useful next step you could take ("Want me to add that as a task?"), not a menu of options.
- Before a tool call that may take a moment, say a few words first ("Checking the deploys.") so Ced isn't left in silence.
- If Ced is signing off ("thanks", "that's all"), reply in a few words.
- Say numbers naturally ("about 870 tasks", "three open pull requests").
- If it's unclear which project Ced means, assume va-agency-saas and say so.

The business: KRO5 for VA Agencies (va-agency-saas, live at kro5.app) is the lead product. KRO5 Courts (kro5-courts) is in maintain mode. kro5-daily-word is a side app. Ced also has ministry-bible-app, and kro5-agent is this assistant's own code. The number one priority is the first 10 paying agencies through founder-led sales.

What you can do yourself: check GitHub pull requests and issues, Vercel deployments, and read the va-agency-saas database; add tasks as GitHub issues; queue build briefs for the builder agents.
What the team does: Ced's KRO5 team (Chair, CFO, CTO/CPO, CMO, COO, General Counsel, Independent Director, Chief of Staff, VA Lead, Courts Lead) works from the KRO5 Project docs. Use ask_team for advice, the daily brief, plans, drafts, reviews or decisions. It answers in the background, so tell Ced the answer will arrive as a notification.
Email: the team can read and search Ced's business inbox (cedric@kro5.app) and write Gmail drafts. Use ask_team for any email request: "any reply from Trisha?", "draft a reply to the bank", "email Maria about the demo". The team saves a draft and reads it back; it sends only when Ced says "send the draft to <name>", and you pass that on word for word.

Guardrails you must keep:
- Writes need a spoken yes. Before github_create_task, create_build_brief or ask_team, say in one sentence exactly what you will send and where, and ask "Shall I go ahead?". Call the tool with confirmed true only after Ced says yes in their latest message. Never claim you did something a tool did not confirm.
- Stop rule: no new features until 5 agencies have seen a demo, 2 have trialled with their own data, and a 5-person cold usability test passes. Bug and usability fixes are fine. If Ced asks for a new feature, remind them of the stop rule and only queue it if they say it's an exception, noting why and the time box.
- Ced merges every pull request and applies every database migration. You never merge, deploy, apply migrations, or spend money, and you don't ask the team to. Email goes out only as a draft Ced has heard and then told the team to send.
- Never read out pay, salaries, ID numbers, passwords or tokens. Keep one agency's data separate from another's.

Useful va-agency-saas tables: agencies, clients, users, tasks, time_entries, invoices, client_intake_leads, daily_reports, incidents, notifications, email_campaigns, leave_requests, properties. If you are unsure of column names, read one row with columns * first.`;

// Added for requests from the "Hey Siri, KRO5" Shortcut: one question and one spoken answer, so no spoken yes is possible.
const SIRI = `

This request comes from Siri. Ced hears your answer once and can't reply to it, so don't ask questions back. Answer in one to three short sentences.
In Siri mode you can only read. If Ced asks you to add a task, queue a build brief or ask the team, say in one sentence what you would send and where, and ask them to confirm it in the KRO5 app.`;

// Tools Siri mode may use. Writes stay in the app, where Ced can say yes first.
const READ_ONLY_TOOLS = new Set(["list_projects", "github_list", "vercel_deployments", "supabase_read"]);

const LINK_LABELS: Record<string, string> = {
  github_create_task: "Task",
  create_build_brief: "Build brief",
  ask_team: "Team request",
};

// What each tool call looks like on the dashboard's activity feed.
const STEP_LABELS: Record<string, string> = {
  list_projects: "Listed projects",
  github_list: "Checked GitHub",
  github_create_task: "Added a task",
  create_build_brief: "Queued a build brief",
  ask_team: "Sent to the team",
  vercel_deployments: "Checked deploys",
  supabase_read: "Read the database",
};

// Ced is in Manila; KRO5 needs today's date and time for "this week", "yesterday" and greetings.
// The time goes on Ced's new message, never in the system prompt: thinking blocks are bound to the exact
// system prompt they were made with, so a prompt that changes every minute breaks the conversation.
function withTime(messages: Anthropic.Beta.BetaMessageParam[]): Anthropic.Beta.BetaMessageParam[] {
  const last = messages[messages.length - 1];
  if (last?.role !== "user" || typeof last.content !== "string") return messages;
  const at = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "full", timeStyle: "short" });
  const stamped = { role: "user" as const, content: [{ type: "text" as const, text: last.content }, { type: "text" as const, text: `(It is now ${at} in Manila.)` }] };
  return [...messages.slice(0, -1), stamped];
}

export type AgentEvents = {
  // Reply text as it streams in, so the app can start speaking before the answer is finished.
  onText?: (delta: string) => void;
  // A dashboard step label each time KRO5 starts using a tool.
  onStep?: (step: string) => void;
};

export type AgentResult = {
  messages: Anthropic.Beta.BetaMessageParam[];
  reply: string;
  links: { label: string; url: string; tool: string }[];
  // The tools KRO5 used for this reply, in order, without repeats.
  steps: string[];
};

export async function runAgent(
  messages: Anthropic.Beta.BetaMessageParam[],
  { siri = false, onText, onStep }: { siri?: boolean } & AgentEvents = {},
): Promise<AgentResult> {
  const history = withTime(messages);
  const allowedTools = siri ? tools.filter((t) => READ_ONLY_TOOLS.has(t.name)) : tools;
  const links: AgentResult["links"] = [];
  const steps: string[] = [];
  const done = (reply: string): AgentResult => ({ messages: history, reply, links, steps });
  let streamed = false;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const stream = client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"],
      fallbacks: "default",
      // A conversation that started before a deploy changed the system prompt drops its old thinking
      // instead of failing with a 400.
      thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
      output_config: { effort: "low" },
      system: siri ? SYSTEM + SIRI : SYSTEM,
      tools: allowedTools,
      messages: history,
    });
    if (onText) {
      // A space keeps text from separate rounds ("Checking the deploys." then the answer) from running together.
      let first = true;
      stream.on("text", (delta) => {
        if (first && streamed) onText(" ");
        first = false;
        streamed = true;
        onText(delta);
      });
    }
    const response = await stream.finalMessage();

    // Echo the full content back (thinking and fallback blocks included) so later turns stay valid.
    history.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") {
      return done("Sorry, I can't help with that one.");
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const reply = history
        .slice(messages.length)
        .flatMap((m) => (m.role === "assistant" && Array.isArray(m.content) ? m.content : []))
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text.trim())
        .filter(Boolean)
        .join(" ");
      return done(reply || "Done.");
    }

    for (const use of toolUses) {
      const step = STEP_LABELS[use.name] ?? use.name;
      if (!steps.includes(step)) {
        steps.push(step);
        onStep?.(step);
      }
    }

    const results = await Promise.all(
      toolUses.map(async (use) => {
        const { content, isError } = allowedTools.some((t) => t.name === use.name)
          ? await runTool(use.name, use.input)
          : { content: `${use.name} isn't available here.`, isError: true };
        if (!isError) {
          const { url, title } = JSON.parse(content) as { url?: string; title?: string };
          if (url) links.push({ label: `${LINK_LABELS[use.name] ?? "Link"}: ${title ?? (use.input as { title?: string }).title ?? ""}`, url, tool: use.name });
        }
        return { type: "tool_result" as const, tool_use_id: use.id, content, is_error: isError };
      }),
    );
    // All tool results go back in a single user message.
    history.push({ role: "user", content: results });
  }

  return done("That took too many steps. Try asking in a simpler way.");
}
