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

## M4 — Video + audio ✅ automated (2026-11-14) · manual tests pending
- [x] `services/localMedia.ts`: permission at Start, denied / no-device / in-use / insecure errors, audio-only fallback, stop all tracks
- [x] `iceServers` in `session:matched` (STUN only until M5)
- [x] `services/peer.ts`: impolite side offers first, perfect negotiation as safety net, one connection per session
- [x] `services/chatController.ts`: reconcile camera and call with the state; unit-tested with fakes
- [x] Video tiles (partner large, self small and mirrored), mute and camera buttons, "camera off" / "muted" / "connecting" / "couldn't connect" notices, waiting-screen preview
- [x] Playwright with pretend camera: video arrives both ways; Next swaps the stream; no live tracks after Leave; permission problems
- [x] Manual checklist written: [MANUAL_TESTS.md](MANUAL_TESTS.md)
- [ ] **Needs manual test (you):** M4-1 to M4-8 on your laptop with a real camera
- [ ] Push and confirm CI is green

## M5 — Deploy beta + TURN
- [ ] Cloudflare account + TURN key; `turn/cloudflareTurn.ts` with credential caching
- [ ] Deploy server to Render (Singapore), web to Vercel; set `NODE_ENV=production`, `CORS_ORIGIN`, `OPEN_WINDOWS`
- [ ] Per-IP connection cap, once we know how Render reports the real client IP (D-025)
- [ ] Scheduled pre-opening ping
- [ ] Replace `turn/iceServers.ts` with Cloudflare credentials refreshed in the background (handing them out at match time must stay synchronous)
- [ ] **Needs manual test:** campus Wi-Fi ↔ mobile data, phone ↔ laptop, Chrome/Safari/Firefox, Android/iOS, a real second person (echo, delay, quality)

## M6 — Reliability hardening
- [ ] ICE restart once when a call fails or stays disconnected (today the user is told and can press Next)
- [ ] Reconnect grace via Socket.IO connection-state recovery
- [ ] Server-restart behavior ("Connection lost, tap to rejoin")
- [ ] Load test: ~300 simulated clients against the deployed free instance → decide whether a paid plan is needed (D-009)

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
