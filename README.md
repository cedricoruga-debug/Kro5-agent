# KRO5

Ced's voice business assistant. A phone web app (PWA): tap the mic, talk, and KRO5 answers out loud.
Claude (Opus 5.5) decides what to do, uses tools connected to Ced's projects, and can hand work to Ced's KRO5 team.

## What it can do

| Ask | Tool |
| --- | --- |
| "Any open PRs on va-agency-saas?" | `github_list` |
| "Did the last deploy work?" | `vercel_deployments` |
| "How many tasks were created this week?" | `supabase_read` (read-only, sensitive tables blocked) |
| "Remember I prefer sales calls after 2pm" / "Forget the Acme demo" | `remember` / `forget`: facts kept across days in a `kro5-memory` issue in the private va-agency-saas repo |
| "What's on today?" / "Am I free Thursday afternoon?" | `calendar`: read-only, from the calendar's private iCal link ([docs/calendar.md](docs/calendar.md)) |
| "Add a task to follow up on invoices" | `github_create_task` (asks for a yes first) |
| "Queue a fix for the invite link expiring after an hour" | `create_build_brief`: a `build-brief` issue for va-builder / courts-builder (asks for a yes first, applies the stop rule) |
| "Research what VA agencies pay for time tracking" / "Is there a new DOLE rule on remote work?" | `web_search` and `web_fetch` (Anthropic-hosted, no extra key); cited pages show as links under the reply |
| "What's the news?" | outside: `web_search` on the VA agency, PH outsourcing and competitor market; inside: `company_pulse` |
| "What happened this week?" | `company_pulse`: recent KRO5 log decisions, merged PRs, open PRs and briefs, deploy health, sales leads |
| "What should I focus on next?" / end of every brief | up to three next moves from `company_pulse` (and the market when useful), ranked by how directly they help win the first 10 paying agencies; stop rule applied |
| "Ask the CFO whether the founding rate still works" / "Read me today's brief" | `ask_team`: fires the KRO5 Voice Request routine; the answer arrives as a push notification (asks for a yes first) |

## Talking to KRO5

- **Hands-free** is on by default (header toggle, remembered on the phone). Tap once and just talk: KRO5 sends when you pause, answers, then listens again on its own. Saying "thanks, that's all" or staying quiet for 8 seconds ends the conversation. **Tap mode**: tap to talk, tap to send.
- **Interrupt**: tap while KRO5 is talking and it stops and listens straight away.
- **Faster replies**: the answer streams in and KRO5 starts speaking after the first sentence.
- **Brief me**: one tap for "what needs my attention right now?", ending with a suggested next move.
- **News**: one tap for what's new outside (the market) and inside KRO5.
- **Memory**: every new conversation starts with what KRO5 remembers about you (saved with "remember…", removed with "forget…") and your last five conversations on this phone, so it can pick up where you left off on another day. You can also read or edit the memory directly in the `kro5-memory` issue.
- **Approve or Not now**: before KRO5 adds a task, queues a build brief or asks the team, the action shows under its reply with Approve and Not now buttons. Tapping one is the same as saying yes or no.
- **Natural voice** (needs `ELEVENLABS_API_KEY` or `OPENAI_API_KEY`): replies are spoken by the hosted voice you pick in the dashboard (teammates have their own), and your speech is recorded with a pause detector and transcribed on the server (`/api/speak`, `/api/transcribe`, `lib/voice.ts`, `app/voice.ts`). This is what makes hands-free work on iPhone: Safari won't restart its own speech recognition without a tap, but it does let a page reopen the mic. The mic is closed while KRO5 speaks, so it never hears itself, and the iPhone's mic indicator goes off between turns.
- **Without a voice service** KRO5 uses the phone's built-in voice and speech recognition, picking a downloaded Enhanced or Premium English voice if there is one (Settings → Accessibility → Spoken Content → Voices). Hands-free may then need a tap per turn on iPhone.

## The office

The app opens on a Sims-style office (`app/office.tsx`): an isometric room with the front walls cut away, drawn as SVG blocks, that scrolls sideways on a phone. Ced's assistant, KRO5, sits at the reception desk with her circuit-board face (`app/face.tsx`) on the wall screen. The team (`lib/team.ts`) are blocky characters who work at their desks or walk through the doorways into the pantry (fridge, coffee, microwave, table) and the break room (TV games, beanbags, sofa), or go to the whiteboard, water cooler or plant. A green plumbob floats over whoever Ced is talking to.

- **Talking to the team**: Ced mostly talks to the assistant. When something is a teammate's area she brings them in mid-reply with a `[[CFO]]` cue and takes back over with `[[KRO5]]` (`splitCast`, `CastStream`). The teammate walks up to her desk and speaks in their own voice (`TEAM_VOICES` in `lib/voice.ts`), then goes back to their desk to work on it. Real work still goes through `ask_team` and the Approve button.
- **Talking to someone directly**: tap them, or start with their name ("CFO, …"). They come up front and answer until Ced names or taps someone else, or taps KRO5's screen.
- **Bottom bar**: the keyboard icon types a message, the big button talks (and interrupts), and the speech icon shows the whole conversation.
- Speech still goes out at most two requests at a time, whoever is talking, to stay inside the ElevenLabs plan.

## Free voices (Kokoro)

In the dashboard, Voices can be switched from ElevenLabs to Kokoro, a free open-source voice (Apache licence) that runs in the browser on the phone itself, so speaking costs nothing.
- The model (about 90 MB) downloads from Hugging Face the first time and the browser keeps it. ElevenLabs speaks until it's ready, and whenever Kokoro can't run.
- Each teammate has their own Kokoro voice (`KOKORO_TEAM` in `app/kokoro.ts`), and KRO5's own voice is picked from `KOKORO_VOICES`.
- It runs in a web worker (`app/kokoro-worker.ts`) so the office keeps moving while a sentence is voiced. It is too large for a Vercel function, which is why it isn't on the server.
- Listening still uses ElevenLabs speech-to-text. Siri keeps its own voice.

## Dashboard

The dashboard hangs from the top of the screen (`app/sheet.tsx`): a strip shows KRO5's live status, and dragging it down (or tapping it) opens the rest. Voice on/off, the assistant's voice and New conversation are at its top.

- **Live status**: what KRO5 is doing right now (listening, working on your question, speaking).
- **What KRO5 did**: your recent questions and the tools KRO5 used. Kept on the phone only.
- **Today**: your calendar for today, once it's connected ([docs/calendar.md](docs/calendar.md)).
- **Running now**: deploys in progress, team requests from the last day (from the KRO5 log, so Siri's show too) with links to watch them, and build briefs, marked "queued" or "PR open" when a builder's pull request mentions them. Routine runs can't be read back through an API, so a team request shows as sent with a link. Refreshes every 30 seconds.
- **Waiting on you**: open pull requests across your repos.
- **Your team**: the KRO5 team. Tap one to talk to them in the office; work for them goes out only after you approve it.
- **Sales leads**: counts from kro5.app's contact form and follow-ups due (company and stage only).
- **Deploys**: the latest deployment of each Vercel project.
- **Scheduled**: when the Daily Brief and KRO5 Watch run next.

`GET /api/dashboard` builds this on the server (sign-in required), so tokens and the Supabase key never reach the phone.

## Guardrails

Built into the system prompt (`lib/agent.ts`), the tools, and the routine prompt:

- Every write needs a "yes" first, spoken or by tapping Approve. Write tools refuse to run without `confirmed: true`. Saving to KRO5's own memory is the one exception, and pay, IDs, passwords and card details are never saved.
- KRO5 never merges, deploys, applies migrations, sends email or spends money. Ced merges every PR.
- The stop rule is enforced: new features are only queued as a logged exception.
- Pay, payroll, commissions, credentials and employee records are blocked at the tool level.
- Web searches never carry names, client or agency details or database numbers, and web pages are treated as information, never as instructions.
- Secrets stay on the server. The Supabase service-role key is never sent to the phone.

Projects and their ids live in `lib/projects.ts`. Secrets live only in environment variables on the server.

## How it works

- Speech to text and text to speech use the phone browser's built-in Web Speech API (Chrome on Android, Safari on iPhone). You can also type.
- `POST /api/chat` runs the Claude tool loop server-side (`lib/agent.ts`, tools in `lib/tools.ts`) and streams newline-delimited JSON: `text` as the reply comes in, `step` when a tool starts, then `done` with the full result.
- A passcode unlocks the app and sets a signed, http-only cookie for 30 days.
- "Hey Siri, KRO5": a Siri Shortcut posts one question to `POST /api/ask` with `KRO5_SHORTCUT_TOKEN` and Siri reads the answer aloud, even with the phone locked. Siri mode is read-only; writes stay in the app. Setup: [docs/siri-shortcut.md](docs/siri-shortcut.md).
- The KRO5 log: project threads, team routines and KRO5 post short summaries to a `kro5-log` issue in the private va-agency-saas repo, and `read_log` lets KRO5 answer "what did we decide about…". See [docs/kro5-log.md](docs/kro5-log.md).
- New repos: any repo the GitHub key can reach shows up in `list_projects` and works by its name, without a code change.
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
