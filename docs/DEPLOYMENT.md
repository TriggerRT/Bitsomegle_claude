# Bitsomeggle — Putting it online

A step-by-step guide to deploying the beta. Everything here uses free plans.

**Status of this guide:** written from the providers' documentation (checked November 2026)
and rehearsed locally as far as possible. It has **not** been followed end to end on real
accounts yet. Menu names on the three websites may differ slightly from what is written
here. If a step doesn't match what you see, stop and tell Claude what the page shows.

## What goes where

| Piece | Where it runs | What it is |
|---|---|---|
| Web app | **Vercel** | The page people open. Just files; no secrets |
| Server | **Render** | Matches people, passes text and call-setup messages |
| TURN relay | **Cloudflare** | Carries video for pairs who cannot connect directly |

You need an account on each. Sign in to Vercel and Render **with your GitHub account**,
so they can read the repository.

**Money:** Cloudflare asks for a card before it lets you create a TURN key (found on
2026-11-14), even though the price shown is $0. Read "Before you give Cloudflare a card"
in part 1 first. Vercel and Render should not ask for one; if they do, **stop and tell
Claude** before entering anything.

**Secrets:** the Cloudflare **API token** in part 1 is a password. Paste it only into
Render's dashboard. Never put it in a chat, in git, in Vercel, or in anything whose name
starts with `VITE_`.

## Before you start
The latest code must be on GitHub (`render.yaml` and `apps/web/vercel.json` are what
Render and Vercel read). Ask Claude to commit and push, and wait for CI to go green.

---

## Part 1 — Cloudflare: create the TURN key

**This part is optional for a first deployment.** Without it the site still works: calls
connect wherever a direct path exists, and pairs who would need the relay see "Couldn't
connect video" (text chat still works). You can do parts 2 to 4 first, leave the two TURN
values empty in part 3, and come back here later.

### Before you give Cloudflare a card
- **What you pay today:** $0. The order page says "Due today $0/month".
- **What is free:** the first 1,000 GB of relayed data each month. After that, $0.05 per GB.
- **What that means for us:** a relayed call uses very roughly 0.5 GB per hour, so 1,000 GB
  is about 2,000 relayed call-hours a month. Only pairs who cannot connect directly are
  relayed. A beta with friends uses a few GB.
- **The risk:** there is **no spending cap**. If usage ever passed 1,000 GB in a month,
  the card would be charged for the rest. Roughly: 100 people in relayed calls for 3.5
  hours every single day would be about 2,600 GB, so about $80 a month.
- **Your safety nets:**
  1. A **budget alert** (steps below) emails you as soon as the bill passes $1.
  2. **Off switch:** deleting the TURN key in Cloudflare stops all relay use at once.
     The site keeps working without the relay.
  3. Before a public launch, Claude can add a lower video bitrate and an automatic
     cut-off (TODO.md, M6).
- The other lines on the order page (RealtimeKit minutes, recording) are for Cloudflare
  products Bitsomeggle does not use. They cost nothing unless used.

### Steps
1. Go to https://dash.cloudflare.com and sign up or log in.
2. In the left menu open **Realtime** (older name: **Calls**), then **TURN Server**.
3. Cloudflare shows an order summary for "Cloudflare Realtime" and asks for a payment
   card. Check that it says **Due today $0**, then enter the card yourself.
4. **Set the budget alert straight away:** **Manage Account → Billing → Billable Usage →
   Create budget alert**. Name `any charge`, budget threshold `1` (USD), your email.
   Save. This only sends an email; it does not stop anything.
5. Back in **Realtime → TURN Server**, click **Create** (or "Create TURN app"). Name it
   `bitsomeggle`.
6. Cloudflare shows two values. Copy both into a temporary text file **outside the
   project folder**:
   - **Turn Token ID** → this becomes `TURN_KEY_ID`
   - **API Token** → this becomes `TURN_KEY_API_TOKEN` (the secret; it is shown only once)

You should see: the new key listed on the TURN page.

## Part 2 — Vercel: deploy the web app

1. Go to https://vercel.com and sign in with GitHub.
2. **Add New… → Project**, then **Import** the `Bitsomegle_claude` repository. If it is
   not listed, click "Adjust GitHub App Permissions" and give Vercel access to that
   repository only.
3. **Root Directory:** click **Edit** and choose `apps/web`.
4. **Framework Preset** should say **Vite**. Leave the build settings alone.
5. Open **Environment Variables** and add one:
   - Name: `VITE_SERVER_URL`
   - Value: `https://bitsomeggle.onrender.com`

   This is a guess at the address Render will give the server in part 3. If Render gives
   a different one, you correct it in part 4.
6. Click **Deploy** and wait about a minute.
7. Copy the site's address from the top of the project page. It looks like
   `https://bitsomegle-claude.vercel.app`. Use the short permanent one (under
   **Domains**), not a long one with random letters. Call this the **web address**.

You should see: the Bitsomeggle landing page at the web address, saying "Connecting…"
with the Start button greyed out. That is correct: there is no server yet.

## Part 3 — Render: deploy the server

1. Go to https://render.com and sign in with GitHub.
2. **New → Blueprint**. Connect the `Bitsomegle_claude` repository (give Render access
   to that repository only).
3. Render reads `render.yaml` and shows one service called `bitsomeggle` on the **Free**
   plan in **Singapore**. It asks for three values:
   - `CORS_ORIGIN` → the **web address** from part 2, exactly, with `https://` and with
     **no** `/` at the end
   - `TURN_KEY_ID` → the Turn Token ID from part 1
   - `TURN_KEY_API_TOKEN` → the API Token from part 1

   If you skipped part 1, leave both TURN values empty. You can fill them in later under
   the service's **Environment** tab; saving there restarts the server with the relay on.
4. Click **Apply** (or "Deploy Blueprint"). The first build takes 3 to 5 minutes.
5. Open the `bitsomeggle` service and copy its address from the top of the page, for
   example `https://bitsomeggle.onrender.com`. Call this the **server address**.

You should see: the service marked **Live**. In its **Logs** tab, these lines:
- `TURN credentials refreshed`
- `Bitsomeggle server listening` with `"turnRelay":true`

(Without a TURN key you instead see a warning that the TURN values are not set, and
`"turnRelay":false`. That is expected.)

Then delete the temporary text file from part 1.

## Part 4 — Connect the two

Only needed if the server address from part 3 is **not** exactly
`https://bitsomeggle.onrender.com`.

1. In Vercel: your project → **Settings → Environment Variables** → edit
   `VITE_SERVER_URL` to the real server address (no `/` at the end) and save.
2. **Deployments** → the newest one → **⋯ → Redeploy**. The address is baked into the
   files when they are built, so a redeploy is required for the change to take effect.

## Part 5 — Check it works

Do the tests **M5-1 to M5-4** in [MANUAL_TESTS.md](MANUAL_TESTS.md) now. They take about
five minutes and tell you whether the three pieces are connected properly. The remaining
M5 tests need phones, other networks and a friend, and can follow later.

## Part 6 — Later: opening hours and the wake-up ping

While you test with friends, leave the site always open. When you decide the daily hours:

1. In `render.yaml`, add under `envVars` (Indian time, 24-hour clock):
   ```yaml
         - key: OPEN_WINDOWS
           value: "21:00-00:30"
   ```
2. In `.github/workflows/wake-server.yml`, set the `cron` line to about 15 minutes
   before opening, **in UTC** (Indian time minus 5 h 30 min). 20:45 in India is
   `15 15 * * *`.
3. On GitHub: repository → **Settings → Secrets and variables → Actions → Variables →
   New repository variable**. Name `SERVER_URL`, value the server address. Until this
   variable exists, the wake-up job does nothing.
4. Commit and push. Render redeploys by itself once CI is green.

Why the ping exists: Render's free plan puts the server to sleep after 15 minutes with no
visitors, and waking it takes about a minute. The ping wakes it just before opening. If
it is asleep anyway, the first visitor simply waits on "Connecting…" for up to a minute.

---

## How updates work after this
- **Push to `main`** → Vercel rebuilds the web app, and Render rebuilds the server once
  CI has passed.
- A server update disconnects everyone who is online, so don't push during opening hours.
- Settings written in `render.yaml` are changed by editing that file. The three typed in
  by hand (part 3) are changed in Render's **Environment** tab.

## If something goes wrong

| What you see | Likely cause | What to do |
|---|---|---|
| Site stuck on "Connecting…" for more than 2 minutes | `VITE_SERVER_URL` is wrong, or `CORS_ORIGIN` does not match the web address exactly | Press F12 → Console. A "CORS" error means fix `CORS_ORIGIN` on Render. A "failed to connect" error means fix `VITE_SERVER_URL` on Vercel and redeploy |
| Vercel build fails with "VITE_SERVER_URL is not set" | Part 2, step 5 was skipped | Add the variable, redeploy |
| Render deploy fails with "CORS_ORIGIN must be set" or "Invalid CORS_ORIGIN" | Empty, or has a `/` or a path at the end | Fix it in Render → Environment |
| Render log says "TURN_KEY_ID and TURN_KEY_API_TOKEN must be set together" | Only one of the two was filled in | Fill in both |
| Render log says "TURN credentials: Cloudflare refused" with `401`, `403` or `404` | Wrong token or wrong key id | Re-copy both; if the token is lost, create a new key in Cloudflare |
| "Couldn't connect video" with `?relay=1` (test M5-4) | The relay is not working | Check the Render log for `TURN credentials refreshed`, then tell Claude |
| Render log warns "visitor address not found" | Render reports visitor addresses in a different header than expected | Harmless (the per-IP cap is simply not applied). Tell Claude which names the line `address headers on the first connection` lists |
| Vercel says the deployment was blocked because of the commit author | A Vercel free-plan rule about who made the commit | Tell Claude the exact message |
