import { getDashboard } from "./dashboard";
import { readLog } from "./log";
import { projects } from "./projects";
import { github } from "./tools";

// Inside-the-company news for KRO5 in one call: what was decided or shipped lately, what's open,
// whether the apps are healthy, and how sales leads look. KRO5 uses it for "what's new", briefs
// and its next-move suggestions. Each part fails on its own, like the dashboard.

const DAY_MS = 24 * 60 * 60 * 1000;

type Part<T> = T | { error: string };

async function part<T>(load: () => Promise<T>): Promise<Part<T>> {
  try {
    return await load();
  } catch (err) {
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 120) };
  }
}

async function recentLog(since: string) {
  const { entries } = await readLog(20, "");
  return entries.filter((e) => e.at >= since).slice(0, 10).map((e) => ({ at: e.at, text: e.text.slice(0, 500) }));
}

async function mergedSince(since: string) {
  const repos = projects.flatMap((p) => (p.repo ? [p.repo] : []));
  const perRepo = await Promise.all(
    repos.map(async (repo) => {
      const items: any[] = await github(`/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=20`);
      return items
        .filter((pr) => pr.merged_at && pr.merged_at >= since)
        .map((pr) => ({ repo: repo.split("/")[1], number: pr.number, title: pr.title, merged_at: pr.merged_at }));
    }),
  );
  return perRepo.flat().sort((a, b) => b.merged_at.localeCompare(a.merged_at));
}

export async function companyPulse(days: number) {
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const [log, merged, dashboard] = await Promise.all([part(() => recentLog(since)), part(() => mergedSince(since)), getDashboard()]);
  const show = <T,>(s: { ok: true; data: T } | { ok: false; error: string }) => (s.ok ? s.data : { error: s.error });
  return {
    since,
    decisionsAndUpdates: log,
    shipped: merged,
    openPullRequests: show(dashboard.pulls),
    openBuildBriefs: show(dashboard.openBriefs),
    latestDeploys: show(dashboard.deploys),
    salesLeads: show(dashboard.leads),
  };
}
