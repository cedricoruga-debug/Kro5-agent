# KRO5

Ced's voice business assistant. A phone web app (PWA): tap the mic, talk, and KRO5 answers out loud.
Claude (Opus 5.5) decides what to do, uses tools connected to Ced's projects, and can hand work to Ced's KRO5 team.

## What it can do

| Ask | Tool |
| --- | --- |
| "Any open PRs on va-agency-saas?" | `github_list` |
| "Did the last deploy work?" | `vercel_deployments` |
| "How many tasks were created this week?" | `supabase_read` (read-only, sensitive tables blocked) |
| "Add a task to follow up on invoices" | `github_create_task` (asks for a spoken yes first) |
| "Queue a fix for the invite link expiring after an hour" | `create_build_brief`: a `build-brief` issue for va-builder / courts-builder (asks for a spoken yes first, applies the stop rule) |
| "Ask the CFO whether the founding rate still works" / "Read me today's brief" | `ask_team`: fires the KRO5 Voice Request routine; the answer arrives as a push notification (asks for a spoken yes first) |

## Guardrails

Built into the system prompt (`lib/agent.ts`), the tools, and the routine prompt:

- Every write needs a spoken "yes" first. Write tools refuse to run without `confirmed: true`.
- KRO5 never merges, deploys, applies migrations, sends email or spends money. Ced merges every PR.
- The stop rule is enforced: new features are only queued as a logged exception.
- Pay, payroll, commissions, credentials and employee records are blocked at the tool level.
- Secrets stay on the server. The Supabase service-role key is never sent to the phone.

Projects and their ids live in `lib/projects.ts`. Secrets live only in environment variables on the server.

## How it works

- Speech to text and text to speech use the phone browser's built-in Web Speech API (Chrome on Android, Safari on iPhone). You can also type.
- `POST /api/chat` runs the Claude tool loop server-side (`lib/agent.ts`, tools in `lib/tools.ts`).
- A passcode unlocks the app and sets a signed, http-only cookie for 30 days.
- "Hey Siri, KRO5": a Siri Shortcut posts one question to `POST /api/ask` with `KRO5_SHORTCUT_TOKEN` and Siri reads the answer aloud, even with the phone locked. Siri mode is read-only; writes stay in the app. Setup: [docs/siri-shortcut.md](docs/siri-shortcut.md).
- While KRO5 is open, it keeps the screen awake so the phone doesn't lock mid-conversation.

## Setup

1. Deploy this repo on Vercel (VAhub team) as a new project.
2. Add the environment variables from `.env.example`:
   - `KRO5_PASSCODE`, `KRO5_SESSION_SECRET` (32+ random characters)
   - `ANTHROPIC_API_KEY`
   - `GITHUB_TOKEN`: fine-grained token on your repos with Issues and Pull requests read/write, Contents read
   - `VERCEL_TOKEN`, `VERCEL_TEAM_ID`
   - `VA_SUPABASE_URL`, `VA_SUPABASE_SERVICE_ROLE_KEY`
   - `KRO5_ROUTINE_ID`, `KRO5_ROUTINE_TOKEN`
3. Create the KRO5 Voice Request routine: see [docs/voice-routine.md](docs/voice-routine.md).
4. Open the site on your phone, unlock it, then "Add to Home Screen".

## Local development

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev
```
