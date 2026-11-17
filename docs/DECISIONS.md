# Bitsomeggle — Decision Log

Each entry: **Decision**, **Alternatives**, **Why**, **Revisit when**.
Never delete or rewrite an entry. If a decision changes, add a new entry that says "Supersedes D-xxx" and mark the old one *Superseded*.

Pricing figures were checked in November 2026 and may change.

---

## D-001 — Peer-to-peer WebRTC for audio/video (not ZegoCloud or LiveKit)
*Accepted · 2026-11-13*
- **Decision:** Use the browser's built-in WebRTC with our own signaling over Socket.IO. Media flows directly between the two browsers.
- **Alternatives:**
  - **ZegoCloud UIKit** (previous attempt). $3.99 per 1,000 participant-minutes for video; the 10,000 free minutes are a 30-day trial. One evening with 20 people in calls for 3 h ≈ 3,600 min ≈ $14/night. The UIKit also controls the UI and the room lifecycle, which fights our Next flow. The old integration put the server secret in the browser.
  - **LiveKit Cloud.** Good SDK, but its media server (SFU) adds nothing for 1:1 calls, and the free allowance would be used up quickly.
- **Why:** 1:1 is exactly what peer-to-peer WebRTC is designed for. It costs ~$0, we control the media lifecycle fully (keep the camera across Next, clean teardown), and there's no vendor lock-in.
- **Cost of this choice:** We write signaling and negotiation ourselves. Mitigated by the standard "perfect negotiation" pattern (D-003) and Playwright tests with fake media.
- **Revisit when:** We need group calls, server-side recording, or server-side video moderation.

## D-002 — Cloudflare STUN + TURN
*Accepted · 2026-11-13*
- **Decision:** Free STUN at `stun.cloudflare.com`. Cloudflare Realtime TURN for relaying when a direct connection fails. The server mints short-lived (~4 h) credentials through Cloudflare's API.
- **Alternatives:** Google STUN only (fails on strict NATs and campus firewalls); self-hosted coturn (needs a VM and ops work); Metered.ca (small free tier, kept as fallback); Twilio NTS (paid).
- **Why:** 1,000 GB/month free (≈700+ relayed call-hours), then $0.05/GB. Offers TURN over TLS on port 443, which gets through restrictive firewalls. The long-lived key stays on the server.
- **Open item:** Check whether enabling it requires adding a card.
- **Revisit when:** TURN usage nears 1,000 GB/month.

## D-003 — Perfect negotiation with server-assigned roles
*Accepted · 2026-11-13*
- **Decision:** The server marks one session member `polite` and the other `impolite` in `session:matched`. Both clients run the same perfect-negotiation code.
- **Alternatives:** "Matched user always offers". Simpler, but breaks on renegotiation, and is easy to get wrong. The old 2027 code had both sides offer at once, which caused random failures.
- **Why:** This is the pattern recommended by the WebRTC spec authors. It handles collisions and renegotiation.

## D-004 — Text chat relayed through Socket.IO (not a WebRTC data channel)
*Accepted · 2026-11-13*
- **Why:** The server can check session membership, rate-limit and apply moderation hooks. Text works before, and even without, a working media connection. Content is never stored or logged.
- **Revisit when:** Never likely. The traffic is tiny.

## D-005 — In-memory matchmaking on one server instance; synchronous Matchmaker
*Accepted · 2026-11-13*
- **Decision:** Queue and session state live in memory in one Node process. Every Matchmaker method is synchronous (no `await`), which makes each operation atomic thanks to Node's single-threaded event loop.
- **Alternatives:** Redis-backed queue with Lua scripts (needed for multiple instances; adds a service, latency and cost); the old array-plus-Map design without session ids or invariants.
- **Why:** Expected load is ~20–300 concurrent users within a 3,000-student audience, well within one instance. Correctness comes from synchronous logic, explicit invariants and randomized tests. Redis would not keep live calls alive across a restart anyway, because WebRTC connections drop.
- **Revisit when:** We need more than one server instance, or zero-downtime deploys. Then implement the same Matchmaker interface on Redis + the Socket.IO Redis adapter.

## D-006 — No database (yet)
*Accepted · 2026-11-13*
- **Why:** Nothing needs to persist. Chats are ephemeral and there are no accounts. Report events go to structured logs through a `ModerationSink` interface.
- **Revisit when:** We need persistent reports or bans → free Postgres (Neon or Supabase).

## D-007 — Vite + React + TypeScript SPA (not Next.js)
*Accepted · 2026-11-13 (user choice)*
- **Why:** The app is one interactive screen running entirely in the browser (camera, WebRTC, sockets). Next.js server rendering adds `'use client'` boilerplate and hydration pitfalls without benefit. Static build, free hosting.
- **Revisit when:** We need SEO-heavy content pages (they could be added as a separate static site).

## D-008 — Node.js + TypeScript + Socket.IO 4.8 + zod + pino (no Express)
_(Node version detail refined in D-018: ≥22.12 locally, 24 LTS in production.)_
*Accepted · 2026-11-13*
- **Why:** The user knows Socket.IO, which provides acks, reconnection, heartbeats and connection-state recovery. Zod gives runtime validation and TypeScript types from one schema, shared with the client. The only HTTP routes needed are `/health` and `/status`, so a plain `http` server is enough.
- **Note:** Verify exact package versions when scaffolding (M0).

## D-009 — Hosting: Render free (server) + Vercel Hobby (web), $0 by default
*Accepted · 2026-11-13 (user preference: no spending unless it clearly helps)*
- **Decision:** Server on a Render free web service in Singapore. Static web app on Vercel.
- **Alternatives:** Render Starter $7/mo (always on); Fly.io ≈ $2–3/mo (no free tier for new orgs, CLI-heavy); Railway $5/mo minimum.
- **Why:** The free tier sleeps after 15 min idle (~1 min to wake). With a daily opening window (D-011), a scheduled ping wakes it before opening, and active WebSockets keep it awake. Limits: 0.1 CPU, 512 MB RAM, 750 instance-hours/month.
- **Revisit when:** The M6 load test (~300 simulated clients) shows lag → propose Fly.io Mumbai (~$2–3/mo) or Render Starter ($7/mo).

## D-010 — Single video mode with in-call camera/mic toggles; text panel always visible
*Accepted · 2026-11-13 (user choice)*
- **Decision:** One queue. Everyone joins a video call and can turn their camera and/or mic off during it (an audio-only call = camera off). The text chat panel is always shown during a conversation.
- **Alternatives:** Separate Video and Text lobbies; three lobbies (video, audio, text).
- **Why:** Simplest to run, and one queue maximizes matches when few people are online.

## D-011 — Daily opening window
*Accepted · 2026-11-13 (user choice)*
- **Decision:** The site accepts new matches only within configured IST windows (3–4 h/day). Outside them, the landing page shows a countdown.
- **Why:** With ≤3,000 potential users, spreading them over 24 h would leave the queue empty. Concentrating them makes matching work. It also fits the free hosting tier.
- **Open item:** Exact times and days.

## D-012 — Open access (no BITS email gate)
*Accepted · 2026-11-13 (user choice)*
- **Why:** No accounts and no stored emails. Simplest. Promoted inside BITS.
- **Revisit when:** Abuse from outsiders becomes a problem. Option: a one-time BITS email code that issues an anonymous token (partners never see the email).

## D-013 — No same-IP exclusion; rate limits mainly per socket
*Accepted · 2026-11-13*
- **Why:** On campus, hundreds of students share one public IP (NAT). The old 2027 code refused to match same-IP users, which would block most campus pairings. Per-IP limits exist only as generous flood protection.

## D-014 — Partner-left behavior: no automatic re-queue
*Accepted · 2026-11-13 (default, open to change)*
- **Decision:** If your partner presses Next or disconnects, you see "Stranger left" with a Next button. The person who pressed Next is re-queued immediately.
- **Why:** You decide when your camera goes to a new stranger.
- **Revisit when:** Beta feedback says it feels slow → auto-re-queue after a short countdown.

## D-015 — Camera/mic permission required to enter
*Accepted · 2026-11-13 (default, open to change)*
- **Why:** It's a video app, and requiring permission reduces "lurkers" who only watch. Users can still turn the camera off once in a call, so this is a soft barrier, not a guarantee.

## D-016 — Rebuild from scratch; `reference/` is read-only
*Accepted · 2026-11-13*
- **Why:** Both earlier attempts have correctness bugs (no session ids, duplicate queue entries, self-matching, offer glare, non-atomic Redis matching, a leaked secret). We keep ideas, not code.

## D-017 — Testing strategy
*Accepted · 2026-11-13*
- **Decision:**
  - vitest unit tests for pure logic (Matchmaker, findPartner, rate limiter, openHours, chatMachine).
  - Randomized "fuzz" test of the Matchmaker with invariants checked after every step.
  - Integration tests with many simulated `socket.io-client` users against a real in-process server.
  - Playwright end-to-end tests using Chromium's fake camera/mic, so two browser windows really connect over WebRTC.
  - Manual checklists only for real devices, mobile browsers and campus networks.

## D-018 — Monorepo tooling details (M0)
*Accepted · 2026-11-13*
- **TypeScript 7.0** (the native Go compiler, stable since July 2026). Verified that typecheck, build and `.ts`→`.js` import rewriting work. Fallback if a tool breaks: TypeScript 6.0.x.
- **Imports use `.ts` extensions** + `rewriteRelativeImportExtensions`. Why: no confusing "write `.js` for a `.ts` file" rule.
- **Shared package uses a `"source"` export condition** so dev tools read its TypeScript directly, and production reads `dist/`. Alternative: always build shared first in dev (easy to forget, gives stale-code bugs). Verified: tests and typecheck pass with no `dist/` present; the compiled server runs with `node dist/index.js`.
- **Two tsconfigs per Node package** (`tsconfig.json` for typecheck incl. tests, `tsconfig.build.json` for emit). No project references, because they'd add complexity with no benefit at this size.
- **Node:** minimum 22.12 (installed locally, and required by Vite 8/Vitest 5); CI also runs 24 (production target).
- **Exact dependency versions** (`save-exact`) + committed `package-lock.json` → `npm ci` reproduces the same install everywhere.
- **Biome** lints/formats code only (Markdown excluded so it doesn't reformat the docs).
- **Playwright** is installed in M3, when there's a UI to test, not now.
- **`reference/omegle_2027/app-8fdlxwxjrytd/` is not tracked by git:** it contains its own `.git` folder, so git would store only a broken pointer, and removing that folder would mean editing `reference/`. It stays on disk for reading.

## D-019 — `leave` takes no session id (one `leave` event instead of `queue:leave` + `session:leave`)
*Accepted · 2026-11-13 (M1) · refines the event contract first sketched in ARCHITECTURE §4*
- **Decision:** `Matchmaker.leave(client)` always means "take me out of whatever I'm in". `next` still requires the session id.
- **Why:** Session ids exist to stop **stale** requests from damaging a newer session. A Next can be stale: a double click sends two Nexts, and by the time the second arrives the user is already with a new partner, who must not be skipped unseen. A Leave cannot be harmful in that way, because the user's intent is always "stop now". Guarding it would create a bug instead: if the user presses Leave while waiting, and the server matched them a few milliseconds earlier, a guarded leave would be ignored and they'd be stuck in a call they tried to leave.
- **Alternatives:** Separate `queue:leave{}` and `session:leave{sessionId}` (the original sketch). Rejected for the reason above.

## D-020 — The last partner can be re-matched immediately when nobody else is eligible
*Accepted · 2026-11-13 (M1) · open to change*
- **Decision:** `findPartner` prefers anyone who wasn't your most recent partner, but falls back to that partner if they're the only eligible person waiting.
- **Why:** With only two people online, a strict "never your last partner" rule would leave both waiting forever. It also keeps two-device testing simple.
- **Known downside:** If two people skip each other and nobody else is online, pressing Next pairs them again straight away.
- **Alternative to consider after beta:** a short cooldown (the old code used 15 s) before the same pair can meet again. That needs a timer that re-checks the queue, so it was left out of M1.
- **Not affected:** "Report & skip" (`avoidPartner`) is strict. An avoided pair is never matched again.

## D-021 — Matchmaker returns effects; unknown clients are ignored
*Accepted · 2026-11-13 (M1)*
- **Decision:** Matchmaker methods return a list of effects (`waiting`, `matched`, `session_ended`) for the socket layer to deliver. Only the partner gets `session_ended`. Operations for an unknown client id return no effects instead of throwing.
- **Why:** Returning data keeps the logic free of sockets and directly testable. Ignoring unknown ids is safe, because an event can legitimately arrive just after its sender disconnected, and an exception there could crash the server. States that should be impossible (a client pointing at a missing session) do throw, with a "Matchmaker bug" message.

## D-022 — At closing time, calls in progress continue; only new matches stop
*Accepted · 2026-11-13 (M2) · replaces the "grace period, then end" idea in the first sketch*
- **Decision:** Outside opening hours the server refuses `queue:join`, and `session:next` ends the current call without finding a new partner. It never ends a call by itself.
- **Why:** Ending calls on a timer needs a scheduled job, a new "server ended it" session reason and client handling for it. Letting people finish their conversation is simpler and friendlier, and nobody can start a new one anyway.
- **Revisit when:** Calls running long after closing become a cost problem (TURN usage) or a moderation problem.

## D-023 — Site status travels over the socket; no `GET /status`
*Accepted · 2026-11-13 (M2)*
- **Decision:** Every browser gets a `status` event when it connects. There is no separate HTTP status page.
- **Why:** The web app connects its socket as soon as the page loads, so a second way to fetch the same data would be duplicate code with its own CORS setup.
- **Consequence:** "online" counts every connected browser, including people still on the landing page. The count is sent once on connect; live updates are an M7 item.

## D-024 — Event contract refinements made while implementing (M2)
*Accepted · 2026-11-13*
- **Error event is named `server:error`**, not `error`, to avoid confusion with Socket.IO's own connection errors.
- **`chat:send` has no `clientMsgId`.** Socket.IO's ack already tells the sender which message was accepted.
- **`session:matched` has no `iceServers` yet.** It's added with the WebRTC work (M4) and TURN (M5), where it can be tested.
- **Schemas strip unknown fields instead of rejecting them**, so a future browser adding a field to its call-setup messages doesn't break calls, and nothing unexpected is ever relayed.
- **Events we receive are typed as unknown on the server**, even though the shared package describes them, because a browser can send anything.

## D-025 — Protection limits (M2)
*Accepted · 2026-11-13 · numbers are first guesses, to be tuned after the beta*
- **Decision:** Per-socket token buckets per request type, a strike bucket that disconnects persistent offenders, a 32 KB message cap and a `MAX_CLIENTS` cap. The numbers are in ARCHITECTURE §3.7.
- **Why per socket and not per IP:** on campus, hundreds of students share one public IP (D-013).
- **Not done yet:** a per-IP connection cap. It needs the real client IP, which depends on the hosting proxy, so it belongs with deployment (M5/M6).
- **CORS is not security by itself.** It stops other websites' pages from using our server through a visitor's browser. A script outside a browser can ignore it, which is why every message is validated and rate limited regardless.

## D-026 — Web app state: one reducer, optimistic updates, "leave on refusal" (M3)
*Accepted · 2026-11-14*
- **Decision:** All chat state lives in one pure reducer (`chatMachine.ts`) driven by React's built-in `useReducer`. No state library. Start and Next update the screen before the server replies. If the server refuses or doesn't answer, the client goes idle and sends `leave`.
- **Why a reducer:** every transition is one line in one function and is unit-tested without a browser. It's the client-side twin of the server's Matchmaker.
- **Why "leave on refusal":** a refused Next leaves the server still holding the old session while the screen has moved on. Forcing both sides to idle is the simplest state they can always agree on.
- **Alternatives:** wait for the server before changing the screen (feels laggy on slow campus Wi-Fi); a state library such as XState or Zustand (extra dependency and concepts for about 150 lines of logic).

## D-027 — Styling: plain CSS in one file (M3)
*Accepted · 2026-11-14 · settles the "CSS modules or Tailwind?" open question*
- **Why:** The app has four small screens. One stylesheet with CSS variables is the least to learn and adds no dependency or build step.
- **Revisit when:** The stylesheet passes roughly 500 lines or class names start to clash. Then move to CSS modules.

## D-028 — Dev and test tooling for the web app (M3)
*Accepted · 2026-11-14*
- **`npm run dev`** starts server and web together using `concurrently` (a small dev-only tool).
- **The server's dev script reads `apps/server/.env` if it exists**, using Node's own `--env-file-if-exists`. No `dotenv` dependency.
- **In development the web app finds the server at port 3001 on whatever host served the page**, so no `.env` is needed to get started. A production build requires `VITE_SERVER_URL`.
- **Playwright tests start their own server (port 3101) and web app (port 5273)**, so they never clash with a running `npm run dev`. They run one at a time because they share one matchmaking queue.
- **Unit tests are named `*.test.ts` next to the source; browser tests are `e2e/*.spec.ts`.** That naming is how vitest and Playwright each pick up only their own.
- **No React component unit tests.** Logic is tested in the reducer; the real UI is tested end to end in a browser. A fake-browser layer in between would mostly repeat those.

## D-029 — The impolite side always makes the first offer (M4)
*Accepted · 2026-11-14 · refines D-003*
- **What happened:** With textbook perfect negotiation, both browsers offered at once at the start of every call (both have a camera to add). The polite side then abandoned its offer and answered, as the pattern says. In the Chromium build Playwright ships, that side's ICE gathering then never finished, it sent no network candidates, and no call ever connected.
- **How it was pinned down:** A test page with two `RTCPeerConnection`s and none of our code. One side offering: connected. Both offering, then one backing off: stuck in exactly the same way.
- **Decision:** The polite side does not make the first offer. It waits for the impolite side's offer and includes its camera and microphone in the answer. The collision-handling code stays as a safety net for later renegotiation.
- **Why not just "caller/callee" without perfect negotiation:** We keep the same roles and the same code, so future features that renegotiate (for example screen sharing) are still covered.
- **Not verified:** whether real Chrome, Firefox or Safari have the same stall. With this decision it no longer matters at call start.

## D-030 — Side effects live in a controller outside React, driven by "reconcile" (M4)
*Accepted · 2026-11-14 · extends D-026*
- **Decision:** `ChatController` (a plain class) owns the socket, the camera and the call. Every event goes through the reducer, then `reconcile()` makes the camera and call match the state. `useChat` only creates the controller and re-renders.
- **Why:** (1) Timing: a partner's first call-setup message can arrive before React would have run an effect to create the call. (2) Correctness: with "make reality match the state" there is one place that opens and closes things, so no path (Next, Leave, refused request, lost connection, late event) can forget to switch the camera off or close a call. (3) Testability: the controller is unit-tested with fakes, without a browser.
- **Alternative:** React effects keyed on the session id, as in M3. Rejected for the timing reason, and because cleanup order across several effects is hard to reason about.

## D-031 — A camera is optional, a microphone is required (M4)
*Accepted · 2026-11-14 · refines D-015*
- **Decision:** Permission for camera and microphone is still requested at Start. If the device has no camera, the app falls back to microphone only and the user joins with audio. With no microphone at all, the user can't join.
- **Why:** Many desktop PCs have no webcam, and the brief asks for audio conversations without requiring a camera. A person with neither can't take part in a call at all.

## D-032 — Media behaviour details (M4)
*Accepted · 2026-11-14*
- **"Camera off" pauses the track; it doesn't release the camera.** Resuming is instant and needs no renegotiation. The camera light may stay on until Leave; the manual test notes say so.
- **640×480 is requested**, not HD. Enough for a small chat window, and it keeps TURN data use low.
- **A failed call does not end the session.** The user is told, text still works, and they can press Next. Automatic recovery (one ICE restart) is M6.
- **Mic and camera choices carry over to the next partner**, so someone who switched their camera off isn't suddenly on camera after pressing Next.
- **STUN only for now** (`stun.cloudflare.com`). Calls across restrictive networks need TURN, which is M5.

## D-033 — TURN credentials are fetched in the background and shared (M5)
*Accepted · 2026-11-14 · refines D-002 (which said "~4 h")*
- **Decision:** The server asks Cloudflare for credentials valid 12 hours, refreshes them every hour, and hands the latest set to every pair matched in that hour. Env vars: `TURN_KEY_ID`, `TURN_KEY_API_TOKEN`.
- **Alternatives:** One fresh set per match (needs a network request while matching, which breaks the "matching never waits" rule, or a second message after the match). A long-lived shared password (anyone who copied it could use our relay for as long as it lived).
- **Why 12 h and 1 h:** Cloudflare disconnects a relayed call when its credentials expire. With these numbers every set handed out has at least 11 hours left, far longer than a daily window. Shorter lifetimes would not stop misuse anyway, because anyone can get a fresh set by being matched.
- **Failure behaviour:** keep the previous set while valid, retry every minute, fall back to STUN only. A Cloudflare outage must never stop matching.
- **Not done:** limiting how much relay data one person can use. Revisit if the Cloudflare usage graph shows abuse.
- **Still open:** whether Cloudflare asks for a card when the key is created. The user will find out in DEPLOYMENT.md part 1.

## D-034 — Per-IP connection cap: off by default, trusted header, fail open (M5)
*Accepted · 2026-11-14 · completes the "not done yet" item in D-025*
- **Decision:** `MAX_CLIENTS_PER_IP` (0 = off) caps connections per address. `CLIENT_IP_HEADER` names the proxy header that holds the visitor's address; unset means "use the connection's own address". On Render: `true-client-ip` and a cap of 500, half of `MAX_CLIENTS`.
- **Why so high:** on campus, hundreds of students share one address (D-013). The cap only guarantees that one address can never take the whole server.
- **Why a named header:** behind a proxy every connection appears to come from the proxy. Render's documentation doesn't say which header carries the visitor's address; community reports say `True-Client-IP` / `CF-Connecting-IP`, set by the Cloudflare layer in front of Render. A header that visitors could set themselves must not be used: someone could pretend to be the campus address and use up its allowance.
- **Fail open:** if the header is missing, the connection is accepted and not counted, and one warning is logged. Refusing everybody because of a wrong setting would be much worse than not limiting.
- **To verify after deploying:** the log line "address headers on the first connection" lists which of the usual headers are present (names only). Manual test M5-4.
- **Refusal looks like "server full"** to the browser. A separate message isn't worth a new screen yet.

## D-035 — Deployment is described in files in the repository (M5)
*Accepted · 2026-11-14*
- **Decision:** `render.yaml` (a Render Blueprint) describes the server; `apps/web/vercel.json` holds the web app's build settings and security headers. Secrets and the two addresses are typed into the dashboards.
- **Why:** the settings can be read, reviewed and changed with a commit, and a new deployment is "pick the repository" instead of twenty form fields a beginner has to get right.
- **Render deploys only after CI passes** (`autoDeployTrigger: checksPass`), so a commit with failing tests never reaches users.
- **The Vercel build stops if `VITE_SERVER_URL` is missing or not https.** Without that check the site would deploy and show a blank page.
- **Wake-up ping:** a GitHub Actions schedule, inactive until the variable `SERVER_URL` exists. One run a day costs about a minute of the free Actions allowance. cron-job.org was the alternative; this keeps everything in one place.
- **Opening hours stay unset** (always open) during the beta, so the user can test with friends at any time.
- **Still to learn from the real deployment:** whether Render or Cloudflare ask for a card; the exact dashboard wording.

## D-036 — `?relay=1` switch for testing the relay (M5)
*Accepted · 2026-11-14*
- **Decision:** adding `?relay=1` to the page address makes that browser connect only through TURN.
- **Why:** browsers prefer a direct path, so a working call says nothing about the relay. Phones have no `chrome://webrtc-internals` to inspect. This gives a yes/no test anyone can do.
- **Safe to leave in:** it only restricts the visitor's own connection (and hides their address from the partner). It gives no access to anything.

## D-037 — Findings from the first deployment attempt (M5)
*Accepted · 2026-11-14*
- **Vercel must install from the repository root.** With Root Directory `apps/web`, Vercel ran `npm install` inside that folder. npm then installs only that one workspace's packages (45 instead of 125), so the tools declared at the root (TypeScript, vitest, Node types) were missing and the build failed with "tsc: command not found". Fix: `"installCommand": "cd ../.. && npm ci"` in `apps/web/vercel.json`. Reproduced and then rehearsed locally in a clean copy.
- **Alternative rejected:** declaring those tools again inside `apps/web`. It would work but repeats version numbers in two places.
- **Lesson:** the Render commands had been rehearsed in a clean copy before the first attempt, Vercel's had not. Both are rehearsed now.
- **Cloudflare asks for a card** before a TURN key can be created, although the order shows $0 due and 1,000 GB a month included. This answers the open item in D-002 and D-033. There is no spending cap; budget alerts only send an email.
- **Consequence:** the TURN key is now optional for the first deployment (the server already runs with STUN only). Whether to give Cloudflare a card is the user's decision; the trade-offs are in DEPLOYMENT.md part 1.
- **Outcome (2026-11-14):** the user created the Cloudflare key. On the live server the log showed "TURN credentials refreshed" and a relay-only call connected (M5-3). Render's proxy does send `true-client-ip`, as D-034 assumed.
- **Fallback had the user declined:** Metered's Open Relay (20 GB a month free, about 40 relayed call-hours). Enough for testing, too small for daily use. It would need a second credential source next to `cloudflareTurn.ts`.

## D-038 — Reconnect grace: Socket.IO recovery, our own timer, and a regular status message (M6)
*Accepted · 2026-11-16*
- **Decision:** When someone in a call loses their connection without saying goodbye, the server waits 10 s (`RECONNECT_GRACE_MS`) before ending the call. Coming back as the same client uses Socket.IO's built-in connection state recovery.
- **Found by reading Socket.IO's code:** it can restore a connection only if it still remembers the last message that browser received, and it forgets messages after the recovery window (checked once a minute). A video call can be silent for many minutes, so recovery would have failed in exactly the case we care about. **Fix:** send every browser a small `status` message every 15 s. That also makes the "online" number live, which was an open item. Checked with a one-off run: a call with 80 quiet seconds was resumed.
- **Our own timer decides, not Socket.IO's window.** The window (grace + 15 s + 5 s margin) only has to be long enough. A browser restored after our timer has fired is told `connection:reset`.
- **Tried and rejected: disconnecting such a browser to force a clean reconnect.** Socket.IO keeps the old session restorable, so the browser was restored again on every attempt, in a loop, until the window ran out.
- **Only people in a call get a grace period.** A waiting person kept "half present" could be matched while absent. Their browser simply rejoins the queue when it is back.
- **Tab close and navigation send `leave` first,** so the partner isn't left looking at a frozen picture for 10 s. A tab that is killed outright still costs the partner the 10 s.
- **Protocol number.** Vercel and Render deploy at different moments, and people keep old tabs open. A browser announces `protocol: 2` when it understands kept calls; only those get a grace period. An old tab ends its call on any drop, and the server does the same for it, so the two sides can't disagree.
- **After every reconnect the browser states what it wants** (`leave`, then `queue:join` if it is waiting). That covers buttons pressed while offline, and a server that restarted.
- **Cost:** when someone vanishes for good (laptop lid closed), the partner now learns up to 10 s later than before. Messages are held in server memory for up to about 90 s for replay (never on disk, never logged).
- **Alternative rejected:** our own resume tokens with our own message buffer. More code to get wrong, for the same result.

## D-039 — A broken call gets one rescue attempt (M6)
*Accepted · 2026-11-16 · completes the "M6" note in D-032*
- **Decision:** On `failed`, or after 4 s of `disconnected`, the impolite side calls `restartIce()`; both sides show "Connecting video…". If the call isn't connected within 15 s, or fails again, the user is told it failed. A call that recovers gets a fresh attempt next time.
- **Why only the impolite side:** same reason as D-029. If both sent a restart offer at once, the polite side would have to abandon its own, which is the situation in which Chromium stalls.
- **Why 4 s:** browsers take about 30 s to declare a call failed. Short hiccups heal in a second or two; after 4 s it is worth looking for another route (typical case: phone moved from Wi-Fi to mobile data).
- **Works together with D-038:** the restart offer travels through the server. If that connection dropped too, the offer waits in the browser and is sent on reconnect; the server kept the call for 10 s.
- **Tested** with a stand-in for the browser's call object, because a real call can't be made to fail on demand. **Needs manual test** on real networks (M6-1, M6-2).

## D-040 — Relay cost: bitrate cap now, automatic cut-off deferred (M6)
*Accepted · 2026-11-16 · follows D-037*
- **Done:** video is capped at 600 kbit/s per direction (`MAX_VIDEO_BITRATE`). A relayed call now costs a known amount: about 0.27 GB per hour per direction, so at most about 0.55 GB per call-hour. 1,000 free GB is then at least 1,800 relayed call-hours a month.
- **Deferred: stopping TURN automatically near 1,000 GB.** It needs a second Cloudflare secret (a read-only analytics token and the account id) and a usage query I can't test without real data. Usage today is a few GB. Until then the protections are the $1 budget alert and deleting the TURN key by hand.
- **Revisit when:** the Cloudflare dashboard shows more than about 200 GB in a month, or before announcing the site to the whole campus.

## D-041 — Load-test tool and a once-a-minute stats line (M6)
*Accepted · 2026-11-16*
- **Tool:** `npm run loadtest` connects pretend users who join, exchange call-setup messages of realistic size, chat and press Next, and reports how long the server takes to answer. No video is sent: video never passes through our server.
- **Stats line:** while anyone is connected the server logs, once a minute, people online, waiting, calls, event-loop delay and memory. It answers "how busy was it tonight?" and "was the server keeping up?" from Render's log. Counts only.
- **Local result (laptop, not Render):** 300 users for 75 s: every request answered, chat p95 2 ms, nothing refused or dropped.
- **Not done yet:** the run against the live Render server, which is what decides D-009 (free plan or paid). It needs the M6 code deployed first, and a quiet moment, because real visitors online would be matched with pretend users.

## D-042 — Resuming when the server has not noticed the drop (M6, found by manual test)
*Accepted · 2026-11-16 · corrects a gap in D-038*
- **What happened:** manual tests M6-1 (Wi-Fi off for 3 s) and M6-2 (Wi-Fi to mobile data) failed on the live site. The browser showed "Reconnecting…", came back, and landed on the start page with "Your connection dropped, so the chat ended."
- **Cause:** when Wi-Fi goes off, nothing tells the server. The old connection looks alive there until a health check fails, up to 20 s later. The browser knows at once and reconnects within seconds. Socket.IO only restores a connection it has already seen close, so the returning browser was treated as a new visitor.
- **Why the tests missed it:** every simulated drop closed both ends of the connection. A real network failure closes neither; each side has to find out for itself.
- **Fix (`socket/resumeAdapter.ts`):** a browser asking to be restored proves it knows the connection's private id, which only it was told. If a connection with that id still looks alive on the server, it is closed first, as if the network had reported the drop, and then restored as usual. This uses two Socket.IO internals (`pid`, `_onclose`); versions are pinned and tests cover it.
- **Also:** the web app now retries every 0.5 to 2 s after a drop (Socket.IO's default grows to 5 s), so less of the grace period is wasted.
- **Tests now simulate drops the realistic way** (server not told), in the server tests and in real browser windows. With the fix removed, 3 server tests and 3 browser tests fail.
- **Lesson:** a simulated failure has to fail the way the real thing does. "Both ends closed" was a convenient shortcut that tested a case real networks rarely produce.
- **Confirmed (2026-11-16):** after deployment the user repeated M6-1 and M6-2 on the live site and both passed, as did M6-3.

## D-043 — Render's free plan is enough for 300 people at once (M6)
*Accepted · 2026-11-16 · answers the "revisit" question in D-009*
- **Measured:** 300 pretend users against the live server for 120 s (`npm run loadtest`), run from the user's laptop in India.
- **Result:** all 300 connected; 5,054 chat requests, 1,138 joins, 865 Next presses and 18,009 call-setup messages; nothing refused, dropped or unanswered. Answer times: median 105 ms, 95% within 115 ms, 99% within 170 ms, slowest 421 ms.
- **Reading it:** about 100 ms of every answer is the trip to Singapore and back. The server itself adds roughly 10 ms for most requests, so it was not struggling.
- **Decision:** stay on the free plan. No paid plan is needed for the expected 20 to 300 people.
- **The server's own view (stats lines from Render's log, pasted by the user):** with 301 connected and about 140 calls, `loopDelayP99Ms` was 1 to 2, `loopDelayMaxMs` 82 to 102, memory 108 to 123 MB of the 512 MB allowed. So 99% of the time work started within 2 ms of when it should have: the server was close to idle.
- **Limits of this test:** pretend users are steadier than a real crowd arriving in one minute; it ran for two minutes, not a whole evening.
- **Seen in passing:** with one idle visitor the log sometimes shows a single pause of about 190 ms in a minute (`loopDelayMaxMs`), while the p99 stays at 1 ms. Most likely the shared free machine or memory clean-up. Too rare and too short to notice; worth a second look only if it grows.
- **Revisit when:** the stats line shows `loopDelayP99Ms` above about 100 during real use, or peak attendance passes about 300.

## D-044 — Report and skip (M7)
*Accepted · 2026-11-16*
- **Decision:** one button that reports the partner and moves on. It needs a reason from a fixed list; the two are never paired again; the reported person is not told.
- **Someone who left first can still be reported.** People who misbehave often skip straight away. The server remembers each connection's last chat, so that chat can be reported from the "Stranger moved on" screen.
- **Membership is checked by the server.** A report must name the reporter's current or last chat. Nobody can report a person they were not matched with.
- **No free text.** A reason from a list is enough to count problems, and it keeps what we store to ids and one word. Free text would be content we must never log (hard rule 6).
- **The reported person sees an ordinary skip** (`partner_next`). Telling them invites retaliation in the few seconds they might still share a call with someone.
- **A dialog between the button and the report** asks for the reason and prevents reporting by a slip of the finger.
- **The avoid list lasts as long as both connections do.** It is not stored anywhere else.
- **Records go to the server log** through `ModerationSink` (the extension point for a database later).

## D-045 — Cooldown after several reports, and what it can't do (M7)
*Accepted · 2026-11-16 · numbers are first guesses*
- **Decision:** 3 different reporters within 15 minutes → the reported connection is removed from any queue or chat and refused matches for 10 minutes.
- **Why different reporters:** otherwise one person could block anyone. Each reporter must have been matched with the person, so a group cannot report someone they never met.
- **Honest limit:** without accounts, reloading the page gives a clean record. The cooldown slows a careless offender and shows the behaviour was noticed. It does not stop a determined one.
- **What would:** identity. The cheapest form here is a BITS email sign-in (D-012 kept the site open on purpose). **Recommendation:** watch the `moderation: report` lines in the log after launch. If reports are frequent, adding the email gate is the next step, not a more elaborate cooldown.
- **Rejected:** blocking by IP address (the campus shares a few addresses, D-013); storing a "blocked" flag in the browser (cleared by a private window).

## D-046 — M7 polish decisions
*Accepted · 2026-11-16*
- **Rules on the landing page:** four short lines and "By pressing Start you agree to follow these rules." **No age statement yet:** whether to say "18+" is the user's decision (open question in TODO.md).
- **"N people here right now"** counts everyone connected, including people still on the landing page. It sets expectations ("you're the only one here") more than it measures anything.
- **No bottom-sheet chat on phones.** The stacked layout (video on top, chat underneath) was confirmed on a real phone in M5-5. A sliding sheet would be new behaviour to get wrong for little gain.
- **The validation library is no longer shipped to browsers.** `packages/shared` is marked `"sideEffects": false`, which lets the bundler drop the schema module the web app never uses. Web bundle: 111 KB → 89 KB compressed. Consequence: modules in `shared` must not do anything at import time except define things.
- **A second test server for the "closed" and "full" screens.** Those screens need a server in that state, and the web app's server address is fixed when it is built, so the browser tests start a second server and a second copy of the app.
