"use client";

import { useEffect, useState } from "react";
import { isStale } from "@/lib/build";
import type { Dashboard as DashboardData } from "@/lib/dashboard";
import { nextRun, routines } from "@/lib/schedule";

export type Activity = {
  at: string;
  asked: string;
  reply: string;
  steps: string[];
  links: { label: string; url: string; tool: string }[];
};

const REFRESH_MS = 60 * 1000;

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function when(date: Date): string {
  return date.toLocaleString("en-PH", { timeZone: "Asia/Manila", weekday: "short", hour: "numeric", minute: "2-digit" });
}

const STATE_TONE: Record<string, string> = { READY: "good", ERROR: "bad", CANCELED: "bad", BUILDING: "busy", QUEUED: "busy", INITIALIZING: "busy" };

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {children}
      {note && <p className="note">{note}</p>}
    </section>
  );
}

function Failed({ error }: { error: string }) {
  return <p className="note">Couldn't load this: {error}</p>;
}

export function Dashboard({ live, activity }: { live: string; activity: Activity[] }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [, tick] = useState(0);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      // Signed out, or KRO5 was updated since this page loaded: reload while Ced is just looking.
      if (res.status === 401 || isStale(res)) return window.location.reload();
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  // Refresh every minute while KRO5 is on screen, and straight away when Ced comes back to it.
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
      tick((n) => n + 1);
    }, REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const teamRequests = activity.flatMap((a) =>
    a.links.filter((l) => l.tool === "ask_team").map((l) => ({ at: a.at, asked: a.asked, url: l.url })),
  );
  const readyPulls = data?.pulls.ok ? data.pulls.data.filter((p) => !p.draft) : [];

  return (
    <div className="dashboard">
      <div className={`live ${live === "Idle" ? "" : "on"}`}>
        <span className="pulse" />
        <span>KRO5 · {live}</span>
        <button className="ghost small" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <Card title="What KRO5 did">
        {activity.length === 0 ? (
          <p className="note">Nothing yet. Tap the button and ask something.</p>
        ) : (
          <ul>
            {activity.slice(0, 5).map((a) => (
              <li key={a.at}>
                <p className="row-title">“{a.asked}”</p>
                <p className="row-meta">
                  {a.steps.length ? a.steps.join(" · ") : "Answered"} · {ago(a.at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Team requests"
        note="These run in the background. The answer arrives as a notification; tap a request to watch it."
      >
        {teamRequests.length === 0 ? (
          <p className="note">None sent from this phone yet.</p>
        ) : (
          <ul>
            {teamRequests.slice(0, 5).map((r) => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noreferrer" className="row-title">
                  {r.asked}
                </a>
                <p className="row-meta">Sent {ago(r.at)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Waiting on you">
        {!data ? (
          <p className="note">Loading…</p>
        ) : !data.pulls.ok ? (
          <Failed error={data.pulls.error} />
        ) : readyPulls.length === 0 ? (
          <p className="note">No pull requests to review.</p>
        ) : (
          <ul>
            {readyPulls.slice(0, 6).map((pr) => (
              <li key={pr.url}>
                <a href={pr.url} target="_blank" rel="noreferrer" className="row-title">
                  {pr.title}
                </a>
                <p className="row-meta">
                  {pr.repo} #{pr.number} · {ago(pr.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {data?.openBriefs.ok && data.openBriefs.data > 0 && (
          <p className="note">
            {data.openBriefs.data} build brief{data.openBriefs.data === 1 ? "" : "s"} queued for the builders.
          </p>
        )}
      </Card>

      <Card title="Sales leads">
        {!data ? (
          <p className="note">Loading…</p>
        ) : !data.leads.ok ? (
          <Failed error={data.leads.error} />
        ) : (
          <>
            <div className="stats">
              <div>
                <strong>{data.leads.data.newThisWeek}</strong>
                <span>new this week</span>
              </div>
              <div>
                <strong>{data.leads.data.unhandled}</strong>
                <span>not handled</span>
              </div>
              <div>
                <strong>{data.leads.data.followUpsDue.length}</strong>
                <span>follow-ups due</span>
              </div>
            </div>
            {data.leads.data.followUpsDue.length > 0 && (
              <ul>
                {data.leads.data.followUpsDue.map((f, i) => (
                  <li key={i}>
                    <p className="row-title">{f.company}</p>
                    <p className="row-meta">
                      {f.stage ?? "no stage"} · due {f.due}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>

      <Card title="Deploys">
        {!data ? (
          <p className="note">Loading…</p>
        ) : !data.deploys.ok ? (
          <Failed error={data.deploys.error} />
        ) : (
          <ul>
            {data.deploys.data.map((d) => (
              <li key={d.project}>
                <a href={d.url} target="_blank" rel="noreferrer" className="row-title">
                  <span className={`badge ${STATE_TONE[d.state] ?? ""}`}>{d.state.toLowerCase()}</span> {d.project}
                </a>
                <p className="row-meta">
                  {d.commit ?? "No commit message"}
                  {d.created_at && ` · ${ago(d.created_at)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Scheduled" note="Results land in claude.ai/code and on your phone as notifications.">
        <ul>
          {routines.map((r) => (
            <li key={r.name}>
              <a href="https://claude.ai/code" target="_blank" rel="noreferrer" className="row-title">
                {r.name}
              </a>
              <p className="row-meta">
                Next: {when(nextRun(r))} · {r.what}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      {data && <p className="note center">Updated {ago(data.generatedAt)}</p>}
    </div>
  );
}
