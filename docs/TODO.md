# Bitsomeggle — TODO

Milestones in order. Each one ends **tested** and with the docs updated. Details are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Action for the user
- [ ] Rotate or delete the ZegoCloud project whose secret is in `reference/omegle_2077…/web/.env.local`.

## M0 — Foundations ✅ (2026-11-13)
- [x] `git init`, `.gitignore` (node_modules, dist, `.env*` except `.env.example`, `reference/**/.env*`, `reference/**/*.zip`, embedded old repo)
- [x] Verify current versions (TypeScript 7.0.2, Vite 8.3.8, React 19.3.1, vitest 5.1.0, Biome 2.6.7, tsx 4.23.15; Socket.IO 4.8.4 / zod 4.6.7 / pino 10.4.0 checked, installed in M2; Playwright 1.65 installed in M3)
- [x] npm workspaces: `packages/shared`, `apps/server`, `apps/web`
- [x] `tsconfig.base.json`, Biome config, root scripts (`dev:server`, `dev:web`, `build`, `typecheck`, `test`, `lint`, `format`, `check`)
- [x] GitHub Actions CI: install → lint → typecheck → build → test (Node 22 + 24)
- [x] Fill in the Commands section of `CLAUDE.md`
- [x] First commit + push to GitHub (private repo `TriggerRT/Bitsomegle_claude`); CI green on Node 22 and 24 (confirmed by user, 2026-11-13)

## M1 — Matchmaking core (pure logic) ✅ (2026-11-13)
- [x] `Matchmaker` (connect, join, next, leave, disconnect, getPartner, stats) returning effects, all synchronous
- [x] `findPartner` (FIFO, never self, avoid list, prefer-not-last-partner)
- [x] `assertInvariants()`
- [x] Unit tests: 2 users match; 3 users (one waits); many joining at once; Next; both press Next; repeated Next; disconnect while waiting; disconnect while matched; repeated join; duplicate events; stale sessionId; unknown clients
- [x] Randomized test: 2,000 sequences × 150 operations, invariants and client/server agreement checked after every step
- [x] Bug-injection check: 9 deliberate bugs, all caught
- [x] `npm run test:coverage` added; all real logic in `matchmaking/` is covered

## M2 — Realtime server ✅ (2026-11-13)
- [x] zod event schemas and types in `packages/shared`
- [x] Socket.IO server, CORS allow-list, 32 KB message cap, 10 s heartbeats
- [x] Handlers: `queue:join`, `session:next`, `leave`, `chat:send`, `signal`, `media:state`; stale-session drops through `Matchmaker.getPartner`
- [x] `connect`/`disconnect` wired to the Matchmaker; returned effects delivered
- [x] Token-bucket rate limiter, strikes, `MAX_CLIENTS` cap
- [x] `/health`; opening-hours gate (`schedule/openHours.ts`); `status` event on connect (no `GET /status`, D-023)
- [x] pino logging with no content
- [x] Integration tests with simulated browsers: matching, Next, double Next, disconnects, duplicate/stale events, no message leaks between sessions, malformed payloads, rate limits, 40 users at once
- [x] Bug-injection check: 14 deliberate bugs, all caught
- [x] Live run of the compiled server in production mode

## M3 — First end-to-end slice (text only) ✅ (2026-11-14)
- [x] Web app wired to the server with `socket.io-client`; `VITE_SERVER_URL`
- [x] `npm run dev` runs server + web; server dev script reads `apps/server/.env` if present
- [x] `chatMachine` reducer + unit tests
- [x] `services/socket.ts`, `hooks/useChat.ts`
- [x] Screens: Landing (with closed countdown, notices, server-full retry), Waiting, Conversation, Partner left
- [x] Next, Leave and Cancel without page reload
- [x] Playwright: three windows play the full journey, plus cancel, tab close, rapid Next, empty messages
- [x] Browser-test job added to CI
- [x] CI green after push: both `check` jobs and the new `e2e` browser job (confirmed by user, 2026-11-14)

## M4 — Video + audio ✅ (2026-11-14)
- [x] `services/localMedia.ts`: permission at Start, denied / no-device / in-use / insecure errors, audio-only fallback, stop all tracks
- [x] `iceServers` in `session:matched` (STUN only until M5)
- [x] `services/peer.ts`: impolite side offers first, perfect negotiation as safety net, one connection per session
- [x] `services/chatController.ts`: reconcile camera and call with the state; unit-tested with fakes
- [x] Video tiles (partner large, self small and mirrored), mute and camera buttons, "camera off" / "muted" / "connecting" / "couldn't connect" notices, waiting-screen preview
- [x] Playwright with pretend camera: video arrives both ways; Next swaps the stream; no live tracks after Leave; permission problems
- [x] Manual checklist written: [MANUAL_TESTS.md](MANUAL_TESTS.md)
- [x] Manual tests M4-1 to M4-8 on a laptop with a real camera (confirmed by user, 2026-11-14)
- [x] Pushed (2026-11-14)
- [x] CI green for the M4 push (confirmed by user, 2026-11-14)

## M5 — Deploy beta + TURN ✅ (deployed 2026-11-14, manual tests confirmed 2026-11-16)
- [x] `turn/cloudflareTurn.ts`: credentials fetched in the background, refreshed hourly, read from memory at match time (D-033)
- [x] Per-IP connection cap with a configurable address header (D-034)
- [x] `?relay=1` switch to test the relay (D-036)
- [x] `render.yaml`, `apps/web/vercel.json`, Vercel build check for `VITE_SERVER_URL` (D-035)
- [x] Wake-up job `.github/workflows/wake-server.yml` (inactive until `SERVER_URL` is set)
- [x] Guide written: [DEPLOYMENT.md](DEPLOYMENT.md); manual tests M5-1 to M5-10 written
- [x] Commit and push M5; CI green (confirmed by user, 2026-11-14)
- [x] Fix the Vercel build: install from the repository root (D-037)
- [x] Fix pushed; Vercel build succeeded (2026-11-14)
- [x] Cloudflare TURN key created by the user; web on Vercel, server on Render
- [x] M5-1 to M5-6 confirmed (server alive, call on the live site, relay works, log check, phone ↔ laptop, two networks)
- [x] Addresses recorded in PROJECT_STATUS.md
- [ ] **You:** check the $1 Cloudflare budget alert exists (DEPLOYMENT part 1, step 4)
- [x] M5-7 to M5-10 confirmed by user (2026-11-16): campus Wi-Fi through the relay, other browsers, a real second person, sleep and wake
- [ ] Later: choose opening hours; set `OPEN_WINDOWS`, the wake-up time and `SERVER_URL` (DEPLOYMENT part 6)

## M6 — Reliability hardening · deployed (2026-11-16) · one fix waiting to be deployed, then manual tests
- [x] Reconnect grace: a call survives a short drop of the server connection (D-038)
- [x] Server-restart behaviour: waiting people rejoin by themselves; a lost call is explained on the start page
- [x] One ICE restart when a call fails or stays interrupted (D-039)
- [x] Video bitrate capped at 600 kbit/s (D-040)
- [x] "Online" number sent every 15 s (shown on the page in M7)
- [x] Stats line in the server log once a minute; load-test tool `npm run loadtest`, run locally with 300 users (D-041)
- [x] Commit and push M6; deployed
- [x] Load test against the live server (M6-6): 300 pretend users, no failures → the free plan is enough (D-043)
- [x] M6-4 closing the tab: confirmed by user
- [x] M6-1 and M6-2 **failed** on the live site → cause found and fixed: the server had not noticed the drop (D-042)
- [ ] Commit and push the fix; CI green; Render redeploys
- [ ] **Needs manual test (again):** M6-1 Wi-Fi blip, M6-2 Wi-Fi to mobile data
- [ ] **Needs manual test:** M6-3 long drop, M6-5 server restart
- [x] Stats lines from Render's log during the load test: p99 delay 1 to 2 ms, memory up to 123 MB (D-043)
- [ ] Deferred: stop handing out TURN credentials automatically near 1,000 GB a month. Needs a read-only Cloudflare analytics token. Do it when monthly relay use passes about 200 GB or before a campus-wide announcement (D-040)

## M7 — Safety + UX polish
- [ ] Report & skip, avoid list, temporary cooldown after multiple distinct reports
- [ ] `ModerationSink` structured events
- [ ] Community guidelines notice on landing page
- [ ] "N people online" indicator, with the count updating live (today `status` is sent once on connect)
- [ ] Add the `report` event to the contract
- [ ] Mobile layout (chat as bottom sheet), keyboard accessibility, clear error copy
- [ ] Browser tests for the closed-hours and server-full screens
- [ ] Keep zod out of the web bundle (import only types and constants from `shared`)
- [ ] **Needs manual test:** full UX checklist on mobile and desktop

## Open questions (don't block M0)
- [ ] Exact daily opening window(s) and days (`OPEN_WINDOWS` supports times today; specific weekdays would need a small addition)
- [ ] Tune rate-limit numbers after the beta (ARCHITECTURE §3.7)
- [ ] Avoid-list and cooldown thresholds
- [ ] Landing page wording: 18+ notice vs "for BITS students"
- [ ] Auto-re-queue after partner leaves? (current default: no, D-014)
- [ ] Cooldown before the same two people can be re-paired? (current: immediate if nobody else is waiting, D-020)

## Later / maybe
- Interest-based matching (plug into `findPartner`)
- BITS email gate (D-012)
- Redis + multiple instances (D-005)
