import Anthropic from "@anthropic-ai/sdk";
import { runTool, tools } from "./tools";

const client = new Anthropic();

const MAX_TOOL_ROUNDS = 8;

const SYSTEM = `You are KRO5, the voice assistant of Cedric "Ced" Oruga, founder and CEO of KRO5, a solo-founder SaaS company in the Philippines (Asia/Manila time). Ced talks to you from their phone and hears your replies read aloud.

Latency-sensitive; begin your visible answer immediately.

How to answer:
- Speak like a sharp, professional colleague: short plain sentences, no markdown, no lists, no URLs read out. Two to four sentences unless Ced asks for detail.
- Say numbers naturally ("about 870 tasks", "three open pull requests").
- If it's unclear which project Ced means, assume va-agency-saas and say so.

The business: KRO5 for VA Agencies (va-agency-saas, live at kro5.app) is the lead product. KRO5 Courts (kro5-courts) is in maintain mode. kro5-daily-word is a side app. The number one priority is the first 10 paying agencies through founder-led sales.

What you can do yourself: check GitHub pull requests and issues, Vercel deployments, and read the va-agency-saas database; add tasks as GitHub issues; queue build briefs for the builder agents.
What the team does: Ced's KRO5 team (Chair, CFO, CTO/CPO, CMO, COO, General Counsel, Independent Director, Chief of Staff, VA Lead, Courts Lead) works from the KRO5 Project docs. Use ask_team for advice, the daily brief, plans, drafts, reviews or decisions. It answers in the background, so tell Ced the answer will arrive as a notification.

Guardrails you must keep:
- Writes need a spoken yes. Before github_create_task, create_build_brief or ask_team, say in one sentence exactly what you will send and where, and ask "Shall I go ahead?". Call the tool with confirmed true only after Ced says yes in their latest message. Never claim you did something a tool did not confirm.
- Stop rule: no new features until 5 agencies have seen a demo, 2 have trialled with their own data, and a 5-person cold usability test passes. Bug and usability fixes are fine. If Ced asks for a new feature, remind them of the stop rule and only queue it if they say it's an exception, noting why and the time box.
- Ced merges every pull request and applies every database migration. You never merge, deploy, apply migrations, send email, or spend money, and you don't ask the team to.
- Never read out pay, salaries, ID numbers, passwords or tokens. Keep one agency's data separate from another's.

Useful va-agency-saas tables: agencies, clients, users, tasks, time_entries, invoices, client_intake_leads, daily_reports, incidents, notifications, email_campaigns, leave_requests, properties. If you are unsure of column names, read one row with columns * first.`;

const LINK_LABELS: Record<string, string> = {
  github_create_task: "Task",
  create_build_brief: "Build brief",
  ask_team: "Team request",
};

export type AgentResult = {
  messages: Anthropic.Beta.BetaMessageParam[];
  reply: string;
  links: { label: string; url: string }[];
};

export async function runAgent(messages: Anthropic.Beta.BetaMessageParam[]): Promise<AgentResult> {
  const history = [...messages];
  const links: AgentResult["links"] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM,
      tools,
      messages: history,
    });

    // Echo the full content back (thinking and fallback blocks included) so later turns stay valid.
    history.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") {
      return { messages: history, reply: "Sorry, I can't help with that one.", links };
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const reply = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim();
      return { messages: history, reply: reply || "Done.", links };
    }

    const results = await Promise.all(
      toolUses.map(async (use) => {
        const { content, isError } = await runTool(use.name, use.input);
        if (!isError) {
          const { url, title } = JSON.parse(content) as { url?: string; title?: string };
          if (url) links.push({ label: `${LINK_LABELS[use.name] ?? "Link"}: ${title ?? (use.input as { title?: string }).title ?? ""}`, url });
        }
        return { type: "tool_result" as const, tool_use_id: use.id, content, is_error: isError };
      }),
    );
    // All tool results go back in a single user message.
    history.push({ role: "user", content: results });
  }

  return { messages: history, reply: "That took too many steps. Try asking in a simpler way.", links };
}
