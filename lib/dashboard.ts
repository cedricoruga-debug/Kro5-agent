import { createClient } from "@supabase/supabase-js";
import { calendarEvents, type CalendarEvent } from "./calendar";
import { readLog } from "./log";
import { findProject, projects } from "./projects";
import { env, github } from "./tools";

// The dashboard's business glance. Runs on the server only, so tokens and the Supabase key never reach the phone.
// Each section fails on its own: one missing token shouldn't blank the whole dashboard.

type Section<T> = { ok: true; data: T } | { ok: false; error: string };

export type Deploy = { project: string; state: string; created_at: string; commit?: string; url: string };
export type PullRequest = { repo: string; number: number; title: string; url: string; draft: boolean; created_at: string };
export type Leads = {
  newThisWeek: number;
  unhandled: number;
  // Company and stage only: names, emails and messages stay in va-agency-saas.
  followUpsDue: { company: string; stage: string | null; due: string }[];
};

// Work running in the background: build briefs waiting for or being built, and team requests sent lately.
export type Brief = { repo: string; number: number; title: string; url: string; created_at: string; pull?: { number: number; url: string } };
export type TeamRequest = { at: string; request: string; url?: string };

export type Dashboard = {
  generatedAt: string;
  deploys: Section<Deploy[]>;
  pulls: Section<PullRequest[]>;
  openBriefs: Section<number>;
  briefs: Section<Brief[]>;
  teamRequests: Section<TeamRequest[]>;
  today: Section<CalendarEvent[]>;
  leads: Section<Leads>;
};

async function section<T>(load: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (err) {
    // Keep the reason short: "GitHub 401", not the whole response body.
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message.split(/:\s*[{[]/)[0].slice(0, 120) };
  }
}

const repos = projects.flatMap((p) => (p.repo ? [p.repo] : []));

async function latestDeploys(): Promise<Deploy[]> {
  const withVercel = projects.filter((p) => p.vercelProject);
  return Promise.all(
    withVercel.map(async (p) => {
      const params = new URLSearchParams({ app: p.vercelProject!, limit: "1", teamId: env("VERCEL_TEAM_ID") });
      const res = await fetch(`https://api.vercel.com/v6/deployments?${params}`, {
        headers: { Authorization: `Bearer ${env("VERCEL_TOKEN")}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Vercel ${res.status}`);
      const [d] = (await res.json()).deployments as any[];
      return {
        project: p.id,
        state: d ? (d.state ?? d.readyState) : "NONE",
        created_at: d ? new Date(d.created).toISOString() : "",
        commit: d?.meta?.githubCommitMessage?.split("\n")[0],
        url: `https://vercel.com/cedric-s-va-hub/${p.vercelProject}`,
      };
    }),
  );
}

// Open pull requests per repo, fetched once and shared by the review list and the build-brief status.
const rawPulls = () =>
  Promise.all(repos.map(async (repo) => ({ repo, items: (await github(`/repos/${repo}/pulls?state=open&per_page=30&sort=created&direction=desc`)) as any[] })));

async function openPulls(raw: ReturnType<typeof rawPulls>): Promise<PullRequest[]> {
  return (await raw)
    .flatMap(({ repo, items }) =>
      items.slice(0, 10).map((pr) => ({
        repo: repo.split("/")[1],
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        draft: Boolean(pr.draft),
        created_at: pr.created_at,
      })),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// A builder's pull request names its brief ("Closes #12"), so a brief with a matching open PR is being built.
async function openBriefs(raw: ReturnType<typeof rawPulls>): Promise<Brief[]> {
  const pulls = await raw;
  const perRepo = await Promise.all(
    repos.map(async (repo) => {
      const items: any[] = await github(`/repos/${repo}/issues?state=open&labels=build-brief&per_page=50`);
      const repoPulls = pulls.find((p) => p.repo === repo)?.items ?? [];
      return items
        .filter((i) => !i.pull_request)
        .map((i) => {
          const mention = new RegExp(`#${i.number}\\b`);
          const pr = repoPulls.find((p) => mention.test(`${p.title} ${p.body ?? ""}`));
          return {
            repo: repo.split("/")[1],
            number: i.number,
            title: i.title,
            url: i.html_url,
            created_at: i.created_at,
            ...(pr ? { pull: { number: pr.number, url: pr.html_url } } : {}),
          };
        });
    }),
  );
  return perRepo.flat().sort((a, b) => b.created_at.localeCompare(a.created_at));
}

const TEAM_WINDOW_MS = 24 * 60 * 60 * 1000;

// Team requests from the last day, from any device or Siri, read from the KRO5 log where ask_team records them.
async function recentTeamRequests(): Promise<TeamRequest[]> {
  const { entries } = await readLog(10, "asked the team:");
  const since = new Date(Date.now() - TEAM_WINDOW_MS).toISOString();
  return entries
    .filter((e) => e.at >= since)
    .map((e) => {
      const request = e.text.match(/Asked the team:\s*([\s\S]*?)(?:\nSession:|$)/)?.[1]?.trim() ?? e.text;
      const url = e.text.match(/Session:\s*(https:\/\/\S+)/)?.[1];
      return { at: e.at, request: request.slice(0, 200), ...(url ? { url } : {}) };
    });
}

// KRO5's own sales leads (the kro5.app contact form), not an agency's client data.
async function salesLeads(): Promise<Leads> {
  const { supabase } = findProject("va-agency-saas");
  const db = createClient(env(supabase!.urlEnv), env(supabase!.keyEnv), { auth: { persistSession: false } });
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  // Today in Manila, where Ced sets follow-up dates.
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [fresh, unhandled, due] = await Promise.all([
    db.from("contact_requests").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    db.from("contact_requests").select("id", { count: "exact", head: true }).is("handled_at", null),
    db
      .from("contact_requests")
      .select("company, stage, next_follow_up_on")
      .lte("next_follow_up_on", today)
      .not("stage", "in", "(won,lost)")
      .order("next_follow_up_on", { ascending: true })
      .limit(5),
  ]);
  const error = fresh.error ?? unhandled.error ?? due.error;
  if (error) throw new Error(error.message);
  return {
    newThisWeek: fresh.count ?? 0,
    unhandled: unhandled.count ?? 0,
    followUpsDue: (due.data ?? []).map((r: any) => ({
      company: r.company || "Unnamed lead",
      stage: r.stage,
      due: r.next_follow_up_on,
    })),
  };
}

export async function getDashboard(): Promise<Dashboard> {
  const raw = rawPulls();
  // Handled by the sections that use it; this only stops an unhandled-rejection warning.
  raw.catch(() => {});
  const [deploys, pulls, briefs, teamRequests, today, leads] = await Promise.all([
    section(latestDeploys),
    section(() => openPulls(raw)),
    section(() => openBriefs(raw)),
    section(recentTeamRequests),
    section(() => calendarEvents(0, 1)),
    section(salesLeads),
  ]);
  const openBriefCount: Section<number> = briefs.ok ? { ok: true, data: briefs.data.length } : briefs;
  return { generatedAt: new Date().toISOString(), deploys, pulls, openBriefs: openBriefCount, briefs, teamRequests, today, leads };
}
