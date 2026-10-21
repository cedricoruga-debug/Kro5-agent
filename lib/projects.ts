// The projects KRO5 can act on. Identifiers live here; secrets live in env vars.
export type Project = {
  id: string;
  description: string;
  repo?: string; // owner/name on GitHub
  vercelProject?: string;
  supabase?: { urlEnv: string; keyEnv: string; blockedTables: string[] };
};

export const projects: Project[] = [
  {
    id: "va-agency-saas",
    description:
      "KRO5 for VA Agencies (VA Agency OS), the lead product, live at kro5.app: tasks, time tracking, HR and leave, payroll, billing and invoices, client portal, campaigns, Leads & Renewals intake.",
    repo: "cedricoruga-debug/va-agency-saas",
    vercelProject: "va-agency-saas",
    supabase: {
      urlEnv: "VA_SUPABASE_URL",
      keyEnv: "VA_SUPABASE_SERVICE_ROLE_KEY",
      // Credentials, pay, commissions and personal records stay off-limits to the voice agent.
      blockedTables: [
        "vault_items",
        "vault_access_log",
        "client_gmail_connections",
        "client_titan_connections",
        "client_xero_connections",
        "email_connections",
        "quo_connections",
        "employee_records",
        "employee_pay_items",
        "employee_pay_changes",
        "employee_documents",
        "payslips",
        "payslip_lines",
        "payroll_runs",
        "hr_settings",
        "overtime_decisions",
        "advisors",
        "commissions",
        "commission_lines",
        "commission_payouts",
        "intake_payments",
        "client_bill_rates",
      ],
    },
  },
  {
    id: "kro5-courts",
    description: "KRO5 Courts: badminton and pickleball queuing, game tracking and fee splitting. Maintain-and-grow mode.",
    repo: "cedricoruga-debug/Badminton-app",
    vercelProject: "badminton-app",
  },
  {
    id: "kro5-daily-word",
    description: "KRO5 Daily Word side app at dailyword.kro5.app. Repo location unknown; deployments only.",
    vercelProject: "kro5-daily-word",
  },
  {
    id: "ministry-bible-app",
    description: "Ministry Bible app: daily devotionals and Bible-in-a-year reading plan for church ministry members.",
    repo: "cedricoruga-debug/ministry-bible-app",
  },
  {
    id: "kro5-agent",
    description: "KRO5 itself: this voice assistant app.",
    repo: "cedricoruga-debug/kro5-agent",
    vercelProject: "kro5-agent",
  },
];

export function findProject(id: string): Project {
  const project = projects.find((p) => p.id === id);
  if (!project) {
    throw new Error(`Unknown project "${id}". Known projects: ${projects.map((p) => p.id).join(", ")}`);
  }
  return project;
}

export function requireRepo(project: Project): string {
  if (!project.repo) throw new Error(`${project.id} has no GitHub repo configured.`);
  return project.repo;
}
