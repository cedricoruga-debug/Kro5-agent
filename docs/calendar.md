# Connect your calendar to KRO5

KRO5 reads your calendar through its private iCal link. It can only read it: it can't add, move or delete anything, and no Google sign-in is needed.

1. On a computer, open Google Calendar and go to **Settings** (the gear icon).
2. Under **Settings for my calendars** on the left, click your calendar (usually your name or cedric@kro5.app).
3. Click **Integrate calendar** and copy **Secret address in iCal format**. It ends in `basic.ics`.
4. In Vercel, open the **kro5-agent** project, go to **Settings > Environment Variables**, and add `KRO5_CALENDAR_ICS_URL` with that address for Production and Preview.
5. Redeploy (Deployments > the latest one > Redeploy).

Then ask KRO5 "What's on today?", or look at the **Today** card on the dashboard.

Keep the address private: anyone who has it can read your calendar. If it leaks, click **Reset** next to it in Google Calendar and update the variable in Vercel.

If the secret address isn't shown, your Google Workspace admin settings hide it. In the Google Admin console, go to **Apps > Google Workspace > Calendar > Sharing settings** and allow external sharing of calendar information.
