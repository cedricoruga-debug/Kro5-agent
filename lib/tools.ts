import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { calendarEvents } from "./calendar";
import { addToLog, readLog } from "./log";
import { forget, remember } from "./memory";
import { companyPulse } from "./pulse";
import { GITHUB_OWNER, findProject, projects, requireRepo } from "./projects";

type Tool = Anthropic.Beta.BetaTool;

// Not an enum: besides the known projects, any repo Ced gives KRO5's GitHub key access to works by its name.
const projectIdProp = {
  type: "string",
  description: `Which project to act on: one of ${projects.map((p) => p.id).join(", ")}, or the name of another of Ced's GitHub repos from list_projects.`,
} as const;

const confirmedProp = {
  type: "boolean",
  description:
    "Set true only after you read the exact action back to Ced and Ced said yes in their latest message. Otherwise false.",
} as const;

export const tools: Tool[] = [
  {
    name: "list_projects",
    description:
      "List the projects KRO5 can work on, with their repo, Vercel and Supabase links, plus any other GitHub repos KRO5's key can reach (new projects show up there by themselves).",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "github_list",
    description:
      "List open pull requests or open issues on a project's GitHub repo, newest first. Use for 'what's open', 'any PRs', 'what's Claude working on'.",
    input_schema: {
      type: "object",
      properties: {
        project: projectIdProp,
        kind: { type: "string", enum: ["pulls", "issues"] },
        limit: { type: "integer", description: "1 to 20" },
      },
      required: ["project", "kind", "limit"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "github_create_task",
    description:
      "Create a GitHub issue as a task or reminder on a project's repo. A write: confirm with Ced first.",
    input_schema: {
      type: "object",
      properties: {
        project: projectIdProp,
        title: { type: "string" },
        body: { type: "string" },
        confirmed: confirmedProp,
      },
      required: ["project", "title", "body", "confirmed"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "create_build_brief",
    description:
      "Queue a code change for the builder agents (va-builder / courts-builder): creates a GitHub issue labelled build-brief with a clear brief and acceptance criteria. Ced hands it to the builder, which opens a PR for Ced to review and merge. A write: confirm with Ced first.",
    input_schema: {
      type: "object",
      properties: {
        project: projectIdProp,
        title: { type: "string", description: "Short task title, prefixed fix:, feat: or chore:." },
        brief: {
          type: "string",
          description: "Complete, specific brief for the change, including acceptance criteria.",
        },
        stop_rule_note: {
          type: "string",
          description:
            "Empty for a bug or usability fix. For a new feature, why Ced is making a stop-rule exception and its time box.",
        },
        confirmed: confirmedProp,
      },
      required: ["project", "title", "brief", "stop_rule_note", "confirmed"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "ask_team",
    description:
      "Send a request to Ced's KRO5 team (Board directors, Chief of Staff, product leads, builder agents) by firing the KRO5 Voice Request routine. It runs in the background; the answer arrives on Ced's phone as a notification and in the returned session link. Use for advice, briefs, plans, reviews and anything needing the Project docs. Start the request with the persona when Ced names one, e.g. '@CFO ...' or 'Board meeting: ...'. Confirm with Ced first.",
    input_schema: {
      type: "object",
      properties: {
        request: { type: "string", description: "Ced's request, in full, as the team should read it." },
        confirmed: confirmedProp,
      },
      required: ["request", "confirmed"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "read_log",
    description:
      "Read the shared KRO5 log: short summaries posted by Ced's Claude project threads, team routines and KRO5 itself (decisions, what's done, what's waiting on Ced, links). Use it when Ced asks what was decided or discussed, what's happening, what's waiting on them, or about work you can't find in GitHub. Newest first.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words that must all appear in an entry, e.g. motion graphic. Empty string for the latest entries." },
        limit: { type: "integer", description: "1 to 20" },
      },
      required: ["query", "limit"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "company_pulse",
    description:
      "Inside news for KRO5 in one call: recent KRO5 log entries (decisions, finished work, what waits on Ced), pull requests merged lately, open pull requests and build briefs, the latest deploy of each app, and sales leads (new this week, unhandled, follow-ups due). Use it for 'what's new', 'what happened this week', briefs, and before suggesting what the business needs next.",
    input_schema: {
      type: "object",
      properties: { days: { type: "integer", description: "How far back to look, 1 to 30. Usually 7." } },
      required: ["days"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "remember",
    description:
      "Save one fact or preference about Ced or the business to KRO5's memory, kept across days and read at the start of every conversation. Use when Ced says 'remember…', or shares something lasting (a preference, a standing plan, a key date, who someone is). One short, self-contained sentence. Never save pay, ID numbers, passwords, tokens or card details.",
    input_schema: {
      type: "object",
      properties: { fact: { type: "string", description: "One sentence, e.g. 'Ced prefers sales calls after 2pm Manila time.'" } },
      required: ["fact"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "forget",
    description: "Remove facts from KRO5's memory when Ced says 'forget…'. Removes every remembered fact containing all the words given.",
    input_schema: {
      type: "object",
      properties: { words: { type: "string", description: "Words that the facts to forget contain, e.g. 'Acme demo'." } },
      required: ["words"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "calendar",
    description:
      "Read Ced's calendar (read-only): events between two days, counted from today in Manila (0 is today, 1 tomorrow, -1 yesterday). Use for 'what's on today', 'am I free Thursday', meetings this week, and in a brief.",
    input_schema: {
      type: "object",
      properties: {
        from_day: { type: "integer", description: "First day, -7 to 30. Usually 0." },
        to_day: { type: "integer", description: "Day after the last one, -6 to 31. 1 means just today." },
      },
      required: ["from_day", "to_day"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "vercel_deployments",
    description: "Recent Vercel deployments for a project: state (READY, ERROR, BUILDING), target, commit message, time.",
    input_schema: {
      type: "object",
      properties: { project: projectIdProp, limit: { type: "integer", description: "1 to 10" } },
      required: ["project", "limit"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "supabase_read",
    description:
      "Read-only query on one table in a project's Supabase database. Returns the total matching row count and up to `limit` rows. Use limit 0 to only count. Sensitive tables (credentials, pay, payroll, commissions, employee records) are blocked.",
    input_schema: {
      type: "object",
      properties: {
        project: projectIdProp,
        table: { type: "string", description: "Table name in the public schema, e.g. tasks, clients, invoices." },
        columns: { type: "string", description: "Comma-separated columns, or * for all." },
        filters: {
          type: "array",
          description: "Equality filters, combined with AND. Empty for none.",
          items: {
            type: "object",
            properties: { column: { type: "string" }, value: { type: "string" } },
            required: ["column", "value"],
            additionalProperties: false,
          },
        },
        since: {
          type: "string",
          description: "Only rows with created_at at or after this ISO date, or empty string for no date filter.",
        },
        order_by: { type: "string", description: "Column to sort by descending, or empty string." },
        limit: { type: "integer", description: "0 to 25" },
      },
      required: ["project", "table", "columns", "filters", "since", "order_by", "limit"],
      additionalProperties: false,
    },
    strict: true,
  },
];

// Anthropic-hosted tools: they run on Anthropic's side and their results come back inside Claude's reply.
// Searches go out with Manila as the location so local news and prices come first.
export const webTools: Anthropic.Beta.BetaToolUnion[] = [
  {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: 5,
    user_location: { type: "approximate", city: "Manila", country: "PH", timezone: "Asia/Manila" },
  },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, max_content_tokens: 20000 },
];

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(n)));

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured on the server.`);
  return value;
}

export async function github(path: string, init?: RequestInit) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env("GITHUB_TOKEN")}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 300)}`);
  // A delete answers 204 with no body.
  return res.status === 204 ? null : res.json();
}

// Not an error: the app shows the action with Approve and Not now buttons while KRO5 asks out loud.
const needsConfirmation = {
  awaiting_approval: true,
  note: "Not sent yet. Ced now sees this action with Approve and Not now buttons. Say in one sentence what you will send and where, and ask \"Shall I go ahead?\". Call again with confirmed true only after Ced says yes.",
};

type Input = Record<string, any>;

const handlers: Record<string, (input: Input) => Promise<unknown>> = {
  async list_projects() {
    const known = projects.map(({ id, description, repo, vercelProject, supabase }) => ({
      id,
      description,
      repo: repo ?? null,
      vercelProject: vercelProject ?? null,
      hasDatabase: Boolean(supabase),
    }));
    // Repos the GitHub key can reach that aren't listed above, e.g. a project Ced started recently.
    let otherRepos: string[] = [];
    try {
      const listed = new Set(projects.flatMap((p) => (p.repo ? [p.repo.toLowerCase()] : [])));
      const repos: any[] = await github(`/user/repos?per_page=100&sort=pushed`);
      otherRepos = repos
        .filter((r) => r.owner?.login === GITHUB_OWNER && !listed.has(String(r.full_name).toLowerCase()))
        .map((r) => r.name);
    } catch {}
    return { projects: known, otherRepos };
  },

  async github_list({ project, kind, limit }) {
    const repo = requireRepo(findProject(project));
    const perPage = clamp(limit, 1, 20);
    const items: any[] = await github(`/repos/${repo}/${kind}?state=open&per_page=${perPage}&sort=created&direction=desc`);
    return items
      // The issues endpoint also returns pull requests.
      .filter((item) => kind === "pulls" || !item.pull_request)
      .map((item) => ({
        number: item.number,
        title: item.title,
        author: item.user?.login,
        created_at: item.created_at,
        draft: item.draft ?? undefined,
        labels: item.labels?.map((l: any) => l.name),
      }));
  },

  async github_create_task({ project, title, body, confirmed }) {
    if (!confirmed) return needsConfirmation;
    const repo = requireRepo(findProject(project));
    const issue = await github(`/repos/${repo}/issues`, {
      method: "POST",
      body: JSON.stringify({ title, body: `${body}\n\n_Created by KRO5 from a voice request._` }),
    });
    await addToLog(`Added a task on ${repo}: [${title}](${issue.html_url})`);
    return { number: issue.number, url: issue.html_url };
  },

  async create_build_brief({ project, title, brief, stop_rule_note, confirmed }) {
    if (!confirmed) return needsConfirmation;
    const repo = requireRepo(findProject(project));
    const exception = stop_rule_note ? `\n\n**Stop-rule exception:** ${stop_rule_note}` : "";
    const issue = await github(`/repos/${repo}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title,
        labels: ["build-brief"],
        body: `${brief}${exception}\n\n---\nFor the builder agent: work on a branch, open a PR with evidence, never push to main, never apply database migrations. Ced reviews and merges.\n\n_Created by KRO5 from a voice request._`,
      }),
    });
    await addToLog(`Queued a build brief on ${repo}: [${title}](${issue.html_url})${stop_rule_note ? ` (stop-rule exception: ${stop_rule_note})` : ""}`);
    return { number: issue.number, url: issue.html_url };
  },

  async ask_team({ request, confirmed }) {
    if (!confirmed) return needsConfirmation;
    const res = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${env("KRO5_ROUTINE_ID")}/fire`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("KRO5_ROUTINE_TOKEN")}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: request }),
    });
    if (res.status === 429) return { error: "The team routine is rate limited (30 requests an hour). Try again later." };
    if (!res.ok) throw new Error(`Routine ${res.status}: ${(await res.text()).slice(0, 300)}`);
    // The fire endpoint answers { type: "routine_fire", claude_code_session_id, claude_code_session_url }.
    const data = await res.json();
    await addToLog(`Asked the team: ${request}\nSession: ${data.claude_code_session_url}`);
    return { session_id: data.claude_code_session_id, url: data.claude_code_session_url, title: request.slice(0, 60) };
  },

  async read_log({ query, limit }) {
    const { entries, url } = await readLog(clamp(limit, 1, 20), query);
    if (entries.length === 0) return { entries, note: query ? `Nothing in the KRO5 log mentions "${query}".` : "The KRO5 log is empty so far." };
    return { entries, log: url };
  },

  async remember({ fact }) {
    const saved = await remember(fact);
    return { remembered: saved.text };
  },

  async forget({ words }) {
    const forgotten = await forget(words);
    return forgotten.length ? { forgotten } : { note: `Nothing in memory mentions "${words}".` };
  },

  async calendar({ from_day, to_day }) {
    const from = clamp(from_day, -7, 30);
    const events = await calendarEvents(from, Math.max(from + 1, clamp(to_day, -6, 31)));
    const manila = (iso: string, allDay: boolean) =>
      new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "full", ...(allDay ? {} : { timeStyle: "short" }) });
    return events.length
      ? { events: events.map((e) => ({ title: e.title, start: manila(e.start, e.allDay), end: manila(e.end, e.allDay), allDay: e.allDay, location: e.location })) }
      : { events, note: "Nothing on the calendar in that range." };
  },

  async company_pulse({ days }) {
    return companyPulse(clamp(days, 1, 30));
  },

  async vercel_deployments({ project, limit }) {
    const { vercelProject } = findProject(project);
    if (!vercelProject) return { error: `${project} has no Vercel project configured.` };
    const params = new URLSearchParams({
      app: vercelProject,
      limit: String(clamp(limit, 1, 10)),
      teamId: env("VERCEL_TEAM_ID"),
    });
    const res = await fetch(`https://api.vercel.com/v6/deployments?${params}`, {
      headers: { Authorization: `Bearer ${env("VERCEL_TOKEN")}` },
    });
    if (!res.ok) throw new Error(`Vercel ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const { deployments } = await res.json();
    return deployments.map((d: any) => ({
      state: d.state ?? d.readyState,
      target: d.target ?? "preview",
      url: d.url,
      created_at: new Date(d.created).toISOString(),
      branch: d.meta?.githubCommitRef,
      commit: d.meta?.githubCommitMessage?.split("\n")[0],
    }));
  },

  async supabase_read({ project, table, columns, filters, since, order_by, limit }) {
    const { supabase } = findProject(project);
    if (!supabase) return { error: `${project} has no database configured.` };
    if (supabase.blockedTables.includes(table)) return { error: `The ${table} table is off-limits to KRO5.` };
    const client = createClient(env(supabase.urlEnv), env(supabase.keyEnv), { auth: { persistSession: false } });
    const rowLimit = clamp(limit, 0, 25);
    let query = client.from(table).select(columns || "*", { count: "exact", head: rowLimit === 0 });
    for (const { column, value } of filters as { column: string; value: string }[]) query = query.eq(column, value);
    if (since) query = query.gte("created_at", since);
    if (order_by) query = query.order(order_by, { ascending: false });
    if (rowLimit > 0) query = query.limit(rowLimit);
    const { data, count, error } = await query;
    if (error) return { error: error.message };
    return { count, rows: data ?? [] };
  },
};

export async function runTool(name: string, input: unknown): Promise<{ content: string; isError: boolean }> {
  const handler = handlers[name];
  if (!handler) return { content: `Unknown tool ${name}`, isError: true };
  try {
    const result = await handler(input as Input);
    return { content: JSON.stringify(result), isError: false };
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
