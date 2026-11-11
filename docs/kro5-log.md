# The KRO5 log

KRO5 can't read Claude chats, project threads or routine sessions. The KRO5 log is how it learns what happened there.

- **Where:** the open issue labelled `kro5-log`, titled "KRO5 log", in `cedricoruga-debug/va-agency-saas`. It's in a private repo because it holds business decisions. Kro5-agent is public, so the log must never go there.
- **Who writes:** every Claude project thread, every team routine (KRO5 Voice Request, Daily Brief, Watch), and KRO5 itself (tasks, build briefs and team requests made by voice).
- **Who reads:** KRO5's `read_log` tool, so Ced can ask "What did we decide about…?" or "What's waiting on me?".

## When to post

Post when a thread or routine **decides**, **finishes**, or **starts waiting on Ced** for something. Don't post for chit-chat or progress steps. Post one comment per event, and don't edit old ones.

## Format

Keep it short and plain, because KRO5 reads it aloud. No secrets, tokens, pay, ID numbers or one agency's data.

```markdown
**From:** <thread title or routine name>
**Decided / done:** <one or two sentences>
**Waiting on Ced:** <what Ced needs to do, or "nothing">
**Links:** <PRs, issues, docs>
```

## How to post

- Claude Code (threads and routines): attach `va-agency-saas` and add a comment to the `kro5-log` issue with the GitHub tools, or run `gh issue comment <number> --repo cedricoruga-debug/va-agency-saas --body "..."`. To find the number, run `gh issue list --repo cedricoruga-debug/va-agency-saas --label kro5-log`.
- If the issue doesn't exist yet, KRO5 creates it the first time it logs something.
