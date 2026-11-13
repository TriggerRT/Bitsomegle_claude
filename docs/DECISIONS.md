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
