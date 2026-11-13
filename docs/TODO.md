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
- [ ] First commit + push to a GitHub repo, then confirm CI goes green (**needs you**: create the GitHub repo)

## M1 — Matchmaking core (pure logic)
- [ ] `Matchmaker` (connect, join, next, leave, disconnect) returning effects, all synchronous
- [ ] `findPartner` (FIFO, never self, avoid list, prefer-not-last-partner)
- [ ] `assertInvariants()` helper
- [ ] Unit tests: 2 users match; 3 users (one waits); simultaneous joins; Next; both press Next; disconnect while waiting; disconnect while matched; repeated join; duplicate events; stale sessionId
- [ ] Randomized test: thousands of random operation sequences, invariants checked after every step
- **Done when:** all tests pass; coverage of `matchmaking/` ≈ 100%

## M2 — Realtime server
- [ ] zod event schemas in `packages/shared`
- [ ] Socket.IO server, CORS allow-list, `maxHttpBufferSize`, tuned heartbeats
- [ ] Handlers: queue, next, leave, signal relay, chat relay, media:state; stale-session drops
- [ ] Token-bucket rate limiter
- [ ] `/health`, `/status`; opening-hours gate (`schedule/openHours.ts`) with tests
- [ ] pino logging with no content
- [ ] Integration tests with simulated clients: matching, Next, double Next, disconnects, duplicate/stale events, **no message leaks between sessions**, malformed payloads, rate limits
- **Done when:** integration suite passes

## M3 — First end-to-end slice (text only)
- [ ] Vite React app scaffold
- [ ] `chatMachine` reducer + unit tests
- [ ] `services/socket.ts`, `hooks/useChat.ts`
- [ ] Screens: Landing, Waiting, Conversation (chat panel), Partner left, Closed (countdown), Error
- [ ] Next and Leave without page reload
- [ ] Playwright: two windows Start → match → chat → Next → match a third window → leave
- **Done when:** e2e passes; you can try it locally in two browser windows

## M4 — Video + audio
- [ ] `services/localMedia.ts`: permission request at Start, denied/no-device/in-use errors, stop all tracks on Leave or tab close
- [ ] `services/peer.ts`: perfect negotiation, one RTCPeerConnection per session, close on session end
- [ ] Video tiles (remote large, local picture-in-picture), camera/mic toggles + `media:state` placeholders
- [ ] Playwright with fake camera: remote video receives frames; Next swaps partner; no live tracks after Leave
- [ ] **Needs manual test:** two real devices on the same Wi-Fi (checklist to be written in `docs/MANUAL_TESTS.md`)

## M5 — Deploy beta + TURN
- [ ] Cloudflare account + TURN key; `turn/cloudflareTurn.ts` with credential caching
- [ ] Deploy server to Render (Singapore), web to Vercel; set env vars; CORS
- [ ] Scheduled pre-opening ping
- [ ] **Needs manual test:** campus Wi-Fi ↔ mobile data, phone ↔ laptop, Chrome/Safari/Firefox, Android/iOS

## M6 — Reliability hardening
- [ ] ICE restart once, then end + re-queue
- [ ] Reconnect grace via Socket.IO connection-state recovery
- [ ] Server-restart behavior ("Connection lost, tap to rejoin")
- [ ] Load test: ~300 simulated clients against the deployed free instance → decide whether a paid plan is needed (D-009)

## M7 — Safety + UX polish
- [ ] Report & skip, avoid list, temporary cooldown after multiple distinct reports
- [ ] `ModerationSink` structured events
- [ ] Community guidelines notice on landing page
- [ ] "N people online" indicator
- [ ] Mobile layout (chat as bottom sheet), keyboard accessibility, clear error copy
- [ ] **Needs manual test:** full UX checklist on mobile and desktop

## Open questions (don't block M0)
- [ ] Exact daily opening window(s) and days
- [ ] Avoid-list and cooldown thresholds
- [ ] Landing page wording: 18+ notice vs "for BITS students"
- [ ] Auto-re-queue after partner leaves? (current default: no, D-014)
- [ ] Styling: plain CSS modules or Tailwind?

## Later / maybe
- Interest-based matching (plug into `findPartner`)
- BITS email gate (D-012)
- Redis + multiple instances (D-005)
