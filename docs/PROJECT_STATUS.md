# Bitsomeggle — Project Status

_Last updated: 2026-11-14 (after M3)_

## Phase
**M3 (text chat working in the browser) complete.** You can run it locally and chat between two windows. Next: **M4: video and audio** (see [TODO.md](TODO.md)).

## What exists
| Item | Status |
|---|---|
| Product brief ([MASTER_PROMPT.md](MASTER_PROMPT.md)) | Done |
| Architecture ([ARCHITECTURE.md](ARCHITECTURE.md)) | Server (§3, §4) and text-only web app (§5.1–5.2) implemented; media (§5.3) not started |
| Decision log ([DECISIONS.md](DECISIONS.md)) | D-001 … D-028 |
| `CLAUDE.md` (repo root) | Done |
| Git repository | Branch `main`, pushed to private GitHub repo `TriggerRT/Bitsomegle_claude` |
| npm workspaces: `packages/shared`, `apps/server`, `apps/web` | Implemented, tested |
| Server skeleton: `GET /health`, `PORT` config, graceful shutdown | Implemented, tested (unit + integration tests; dev and compiled modes started and queried by hand) |
| Matchmaking core: `Matchmaker`, `findPartner` (`apps/server/src/matchmaking/`) | Implemented, tested |
| Event contract: zod schemas + types (`packages/shared/src/events.ts`) | Implemented, tested |
| Realtime server: Socket.IO, matchmaking events, chat / signal / media relay (`apps/server/src/socket/`) | Implemented, tested with simulated browsers over real WebSockets |
| Opening hours (`OPEN_WINDOWS`, IST) | Implemented, tested |
| Rate limits, strikes, message size cap, connection cap, CORS allow-list | Implemented, tested |
| Structured logging (pino), no content logged | Implemented; a live run confirmed chat text does not appear in the log |
| Web app, text only: landing, waiting, conversation, partner-left screens; Start / Next / Leave / Cancel; opening-hours countdown; reconnect handling | Implemented, tested (unit + browser tests). Looked at in a browser at desktop and phone width |
| UI state machine (`apps/web/src/state/chatMachine.ts`) | Implemented, tested |
| Browser tests (Playwright, `apps/web/e2e/`) | Implemented; pass locally. CI job added, **untested until pushed** |
| `npm run dev` (server + web together) | Implemented, tested by running it |
| Tooling: TypeScript 7, Biome, vitest 5, Vite 8 | Implemented; lint/typecheck/build/test all pass after a clean `npm ci` |
| GitHub Actions CI (Node 22 + 24) | Implemented, tested: both jobs green on the first push (confirmed by user) |

## Feature status
Status words: Implemented / Tested / Partially tested / Untested / Needs manual test / Blocked.

| Feature | Status |
|---|---|
| Anonymous random matchmaking | Tested end to end in real browser windows (M3) |
| Session lifecycle + stale-event guards | Tested on server and client |
| Text chat | Tested end to end (M3) |
| Video/audio (WebRTC P2P) | Server relays call-setup messages: tested (M2). Browser side: M4 |
| Next button | Tested end to end, no page reload (M3) |
| Waiting / matched / partner-left states | Tested end to end (M3). Closed-hours and server-full screens: logic unit-tested, **not yet seen in a browser** |
| TURN relay | Not started |
| Opening-hours window | Server: tested. Countdown UI: implemented, logic unit-tested, not exercised in a browser test |
| Rate limiting | Tested (M2). Numbers to be tuned after beta |
| Report & skip / moderation hooks | Not started |
| Deployment | Not started |

## Test evidence (M1)
- 57 tests pass (`npm test`), 47 of them for matchmaking.
- Unit tests cover every matchmaking case in MASTER_PROMPT Part 9.
- Randomized test: 2,000 seeded sequences × 150 operations (300,000 operations). After each one it checks the invariants and that a simulated browser, updated only from effects, agrees with the server.
- Bug-injection check: 9 deliberate bugs were added one at a time (stale guard removed, partner left in queue, half-ended session, duplicate join, ghost left in queue, two impolite peers, avoid list ignored, fallback removed, client not deleted). The tests failed for all 9. The original code was then restored.
- Coverage of `matchmaking/`: every line of real logic runs in tests. The only lines not run are the "this should never happen" alarms.

## Test evidence (M3)
- 232 unit and integration tests pass (`npm test`): 48 new for the web app (40 for the state machine).
- 5 browser tests pass (`npm run e2e`), 3 runs in a row. Real Chromium windows against a real server:
  1. Full journey with three people: start, wait, match, chat both ways, Next, match someone else, old messages gone, the left-behind partner is told and can't write, messages reach only the current partner, Leave, and a check that no page was ever reloaded.
  2. Cancel while waiting, then start again.
  3. Closing the tab ends the chat for the partner.
  4. Pressing Next repeatedly from both sides.
  5. Whitespace-only messages are not sent.
- Bug-injection check: 6 deliberate bugs in the web app. 5 were caught (2 by browser tests, 3 by unit tests). The 6th, ignoring the server's `queue:waiting` event, changes nothing visible because the screen already shows "waiting" optimistically, so no test can or should fail.
- Looked at in a browser: landing page and an active conversation, at desktop and phone width.
- **Not verified:** real phones, Safari and Firefox, slow or flaky networks, the closed-hours and server-full screens in a real browser. The CI browser job has not run yet.

## Test evidence (M2)
- 184 tests pass (`npm test`): 127 new in M2, of which 63 are integration tests.
- Integration tests start a real server on a private port and connect simulated browsers over real WebSockets with the same client library the web app will use.
- Covered: every Part 9 matchmaking case again over the network (two users, three users, Next, both pressing Next at once, double-clicked Next, repeated join, disconnect while waiting and while matched), plus 40 browsers joining and pressing Next simultaneously for 5 rounds. After each round every browser's view, rebuilt only from the events it received, equals the server's state.
- Message routing: chat reaches the partner only; nothing leaks to another session, to a waiting user or to an idle user; messages naming an old or foreign session are refused.
- Protection: malformed payloads, unknown events, odd arguments, oversized messages, rate limits, flooding, server full, closed hours, CORS.
- "Nothing arrived" is asserted without sleeping: the test makes a round trip on the same connection, and anything sent earlier must arrive before the reply.
- Stability: the integration suite ran 12 times in a row with no failures.
- Bug-injection check: 14 deliberate bugs in the socket layer (chat broadcast to everyone, session id ignored on relay, no rate limit, no validation, opening hours ignored, and others). The tests failed for all 14. The code was then restored.
- Live check: the compiled server was started in production mode and two real clients matched, chatted and pressed Next. It refuses to start in production without `CORS_ORIGIN`.
- Not covered by automated tests: `index.ts` (the 30-line start-up file), checked by the live run instead.

## Known issues / risks
- Opening the dev site from another device (phone on the same Wi-Fi) is refused by the server's CORS rule until `CORS_ORIGIN` in `apps/server/.env` includes that address. Covered in the M4 manual-test checklist.
- The web bundle is about 108 KB compressed, partly because the validation library (zod) is bundled although the browser doesn't use it yet. To trim in M7.
- The "online" number is sent once when a browser connects and does not update live (M7).
- With only two people online, skipping each other re-pairs them immediately (D-020, by design for now).
- ⚠️ **Leaked secret in old code:** `reference/omegle_2077…/web/.env.local` contains a real ZegoCloud server secret (it was also exposed to browsers through a `NEXT_PUBLIC_` variable). **Action for the user:** rotate it or delete that ZegoCloud project. Since M0, `.gitignore` excludes `reference/**/.env*` and the zip; a `git add` dry run confirmed no env file, zip or `node_modules` would be staged.
- Render free tier: 0.1 CPU. Unknown whether it handles ~300 concurrent sockets smoothly → measured in M6.
- Campus Wi-Fi may block UDP → relies on TURN over TLS on port 443. Confirmed only by manual testing in M5.
- Cloudflare TURN sign-up may require a card (to check in M5).

## Environment variables
### Server (set in the host's dashboard in production; see `apps/server/.env.example`)
| Name | Status | Purpose |
|---|---|---|
| `PORT` | Implemented | HTTP/WebSocket port (Render sets this). Default 3001 |
| `CORS_ORIGIN` | Implemented | Web app address(es) allowed to connect, comma separated. **Required when `NODE_ENV=production`**. Default `http://localhost:5173` |
| `OPEN_WINDOWS` | Implemented | Daily opening windows in IST, e.g. `21:00-00:30`. Empty = always open |
| `MAX_CLIENTS` | Implemented | Cap on simultaneous connections. Default 1000 |
| `LOG_LEVEL` | Implemented | silent, fatal, error, warn, info, debug or trace. Default info |
| `NODE_ENV` | Implemented | Set to `production` on the host |
| `CLOUDFLARE_TURN_KEY_ID` | Planned (M5) | Cloudflare TURN key id (secret) |
| `CLOUDFLARE_TURN_API_TOKEN` | Planned (M5) | Cloudflare TURN API token (secret) |
| `TURN_CREDENTIAL_TTL_SECONDS` | Planned (M5) | Lifetime of minted TURN credentials (~14400) |

### Web (`apps/web/.env`). Public values only; everything here ends up in the browser
| Name | Purpose |
|---|---|
| `VITE_SERVER_URL` | Implemented. Server address. Optional in development (defaults to port 3001 on the same host); **required for a production build** |

## Local setup
```
npm install
npm run dev          # server on :3001 and web app on http://localhost:5173
npm run check        # lint + typecheck + unit and integration tests
npm run e2e          # browser tests (first time only: npx playwright install chromium)
```
To try it: run `npm run dev`, open http://localhost:5173 in two browser windows, press **Start chatting** in both.
Node ≥ 22.12 required. Node 24 LTS recommended (production target).

## Deployment
Not deployed. Plan: server → Render free (Singapore); web → Vercel Hobby; scheduled ping before the daily window. See ARCHITECTURE.md §1.
