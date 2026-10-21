import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { addToLog, readLog } from "./log";
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
  return res.json();
}

const needsConfirmation = {
  error: "Not confirmed. Read the exact action back to Ced and ask them to confirm before calling this again.",
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
