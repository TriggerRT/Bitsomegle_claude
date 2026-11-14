# Bitsomeggle — Project Status

_Last updated: 2026-11-14 (M5 code done, not deployed yet)_

## Phase
**M5 (deploy a beta, add the TURN relay): the code and the deployment files are written and tested locally. The deployment itself has not happened.** It needs you to create three free accounts and follow [DEPLOYMENT.md](DEPLOYMENT.md), then do the M5 tests in [MANUAL_TESTS.md](MANUAL_TESTS.md). After that: M6, reliability (see [TODO.md](TODO.md)).

## What exists
| Item | Status |
|---|---|
| Product brief ([MASTER_PROMPT.md](MASTER_PROMPT.md)) | Done |
| Architecture ([ARCHITECTURE.md](ARCHITECTURE.md)) | Server (§3, §4) and web app (§5) implemented |
| Decision log ([DECISIONS.md](DECISIONS.md)) | D-001 … D-036 |
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
| Video and audio: camera/mic permission and problem screens, peer-to-peer call, self-preview, mute and camera buttons, audio-only fallback | Implemented, tested with a pretend camera in real browser windows. Manual tests M4-1 to M4-8 with a real camera on one laptop: confirmed by user (2026-11-14) |
| Chat controller (`apps/web/src/services/chatController.ts`) | Implemented, tested |
| Browser tests (Playwright, `apps/web/e2e/`) | Implemented, tested: pass locally and in CI (confirmed by user) |
| `npm run dev` (server + web together) | Implemented, tested by running it |
| Tooling: TypeScript 7, Biome, vitest 5, Vite 8 | Implemented; lint/typecheck/build/test all pass after a clean `npm ci` |
| GitHub Actions CI (Node 22 + 24) | Implemented, tested: all three jobs green for the M4 push (confirmed by user, 2026-11-14) |
| TURN relay credentials from Cloudflare (`apps/server/src/turn/`) | Implemented, tested with a stand-in for Cloudflare. **Needs manual test** with a real key (M5-3) |
| Per-IP connection cap (`apps/server/src/socket/ipLimit.ts`) | Implemented, tested. Which header Render uses for the visitor's address is **unverified** until deployed (M5-4) |
| Relay test switch (`?relay=1`) | Implemented, tested |
| Deployment files: `render.yaml`, `apps/web/vercel.json`, `.github/workflows/wake-server.yml` | Implemented. Render's build and start commands were rehearsed locally in a clean copy. **Untested on the real services** |
| Deployment guide ([DEPLOYMENT.md](DEPLOYMENT.md)) | Written from the providers' documentation; **not yet followed on real accounts** |

## Feature status
Status words: Implemented / Tested / Partially tested / Untested / Needs manual test / Blocked.

| Feature | Status |
|---|---|
| Anonymous random matchmaking | Tested end to end in real browser windows (M3) |
| Session lifecycle + stale-event guards | Tested on server and client |
| Text chat | Tested end to end (M3) |
| Video/audio (WebRTC P2P) | Tested end to end with a pretend camera (M4) and confirmed by the user with a real camera on one laptop. Between different networks: **needs manual test** after deployment |
| Next button | Tested end to end, no page reload (M3) |
| Waiting / matched / partner-left states | Tested end to end (M3). Closed-hours and server-full screens: logic unit-tested, **not yet seen in a browser** |
| TURN relay | Server side implemented and tested against a stand-in. **Needs manual test** with a real Cloudflare key (M5-3) |
| Opening-hours window | Server: tested. Countdown UI: implemented, logic unit-tested, not exercised in a browser test |
| Rate limiting | Tested (M2). Numbers to be tuned after beta |
| Report & skip / moderation hooks | Not started |
| Deployment | Files and guide ready. **Not deployed**: waiting on the user's accounts |

## Test evidence (M1)
- 57 tests pass (`npm test`), 47 of them for matchmaking.
- Unit tests cover every matchmaking case in MASTER_PROMPT Part 9.
- Randomized test: 2,000 seeded sequences × 150 operations (300,000 operations). After each one it checks the invariants and that a simulated browser, updated only from effects, agrees with the server.
- Bug-injection check: 9 deliberate bugs were added one at a time (stale guard removed, partner left in queue, half-ended session, duplicate join, ghost left in queue, two impolite peers, avoid list ignored, fallback removed, client not deleted). The tests failed for all 9. The original code was then restored.
- Coverage of `matchmaking/`: every line of real logic runs in tests. The only lines not run are the "this should never happen" alarms.

## Test evidence (M5)
- `npm run check` passes: lint, typecheck, **347 tests**. `npm run e2e`: **18 browser tests** pass.
- New in M5 (52 tests):
  - TURN credentials: the documented request is sent; credentials are replaced hourly; a failed refresh keeps the old ones and retries after a minute; expired ones are no longer handed out; five kinds of bad answer fall back to STUN; the API token and the credentials never appear in the log; nothing is scheduled after stop.
  - With a real server and pretend browsers: both matched browsers receive the relay; the API token is never sent to a browser; matching still works when Cloudflare is unreachable.
  - Per-IP cap: refuses above the cap, other addresses unaffected, the place is freed on disconnect, unknown addresses are not counted, a made-up header is ignored when no proxy is configured.
  - Settings: the two TURN values must come together; header name and cap are validated.
  - Browser: `?relay=1` makes that browser relay-only while the partner stays normal, and text chat still works when video can't connect.
- Bug-injection check: 23 deliberate bugs in the new code (for example: expired credentials still handed out, error details logged, per-IP place never freed, cap off by one, `?relay=1` ignored). **All 23 were caught.**
- **Rehearsal of Render's commands** in a clean copy of the repository, with `NODE_ENV=production`: the build command succeeded; the server refused to start without `CORS_ORIGIN`; with it, `/health` answered, the allowed website got a CORS header and another website did not.
- **One real request to Cloudflare** with a made-up key: Cloudflare answered 404, the server logged "Cloudflare refused" and started normally with STUN only. This shows the address is right and a refusal is handled. It does not show that real credentials work.
- **Not verified:** everything that needs the real services. A real TURN key, Render's build, Vercel's build, the header Render uses for addresses, calls between two networks, phones, Safari, Firefox. See MANUAL_TESTS.md, M5-1 to M5-10.

## Test evidence (M4)
- 295 unit and integration tests pass (`npm test`): 62 new for the web app (37 for the controller, 25 for the state machine) and 1 for the server.
- 17 browser tests pass (`npm run e2e`), 3 runs in a row. The 12 new ones make real WebRTC calls between Chromium windows using its pretend camera and microphone:
  - both people receive moving video and an audio track; the self-preview is silent;
  - Next gives a different video stream from the new partner, three times in a row;
  - after Leave or Cancel, every camera and microphone track the page ever obtained is ended, and going through several partners asked for the camera only once;
  - after Next or Leave, the connection to the previous partner is closed on both sides;
  - camera off and mute are shown to the partner and really disable the tracks;
  - a camera switched off while waiting is off for the new partner from the first moment;
  - blocked camera → help screen and not queued; "Try again" works; no camera → audio only; no microphone → told what to do.
- Bug-injection check: 9 deliberate bugs in the video code (both sides offering first, old call not closed, camera never switched off, old partner's setup messages reaching the new call, cosmetic-only camera button, camera never sent, partner not told, connection never closed, cancelled prompt still joining). 8 were caught at once. The 9th (connection never closed) exposed a gap, so a browser test was added that checks old connections are closed; it now catches that bug too.
- A real fault was found and fixed this way: see D-029.
- Manual tests M4-1 to M4-8 ([MANUAL_TESTS.md](MANUAL_TESTS.md)): confirmed by the user on one laptop with a real camera, two browser windows (2026-11-14).
- **Not verified:** two separate devices, so echo, delay and picture quality between real people are still unknown (M5).
- **Not verified until deployment:** phones, Safari, Firefox, two different networks.
- M4 was pushed on 2026-11-14. The CI result for that push has not been confirmed yet.

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
- **Not verified:** real phones, Safari and Firefox, slow or flaky networks, the closed-hours and server-full screens in a real browser.

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
- Until the server runs with a real Cloudflare key, calls use STUN only: two people on networks that block direct connections see "Couldn't connect video". Text chat still works for them.
- Everyone matched within the same hour gets the same TURN credentials, and there is no limit on how much relay data one person uses (D-033). Fine for a beta; watch the Cloudflare usage graph.
- A server update on Render disconnects everyone online. Don't push to `main` during opening hours.
- The wake-up job's time (`wake-server.yml`) and the opening hours (`render.yaml`) are set in two places and must be changed together.
- Two windows on one laptop share one microphone and speaker, so testing that way echoes unless you wear headphones.
- Opening the dev site from another device (phone on the same Wi-Fi) is refused by the server's CORS rule until `CORS_ORIGIN` in `apps/server/.env` includes that address. Covered in the M4 manual-test checklist.
- The web bundle is about 108 KB compressed, partly because the validation library (zod) is bundled although the browser doesn't use it yet. To trim in M7.
- The "online" number is sent once when a browser connects and does not update live (M7).
- With only two people online, skipping each other re-pairs them immediately (D-020, by design for now).
- ⚠️ **Leaked secret in old code:** `reference/omegle_2077…/web/.env.local` contains a real ZegoCloud server secret (it was also exposed to browsers through a `NEXT_PUBLIC_` variable). **Action for the user:** rotate it or delete that ZegoCloud project. Since M0, `.gitignore` excludes `reference/**/.env*` and the zip; a `git add` dry run confirmed no env file, zip or `node_modules` would be staged.
- Render free tier: 0.1 CPU. Unknown whether it handles ~300 concurrent sockets smoothly → measured in M6.
- Campus Wi-Fi may block UDP → relies on TURN over TLS on port 443. Confirmed only by manual test M5-7.
- Unknown until tried: whether Cloudflare or Render ask for a card, and which header Render uses for visitor addresses (D-034).

## Environment variables
### Server (set in the host's dashboard in production; see `apps/server/.env.example`)
| Name | Status | Purpose |
|---|---|---|
| `PORT` | Implemented | HTTP/WebSocket port (Render sets this). Default 3001 |
| `CORS_ORIGIN` | Implemented | Web app address(es) allowed to connect, comma separated. **Required when `NODE_ENV=production`**. Default `http://localhost:5173` |
| `OPEN_WINDOWS` | Implemented | Daily opening windows in IST, e.g. `21:00-00:30`. Empty = always open |
| `MAX_CLIENTS` | Implemented | Cap on simultaneous connections. Default 1000 |
| `MAX_CLIENTS_PER_IP` | Implemented | Cap on connections from one address. Default 0 (off). 500 in `render.yaml` |
| `CLIENT_IP_HEADER` | Implemented | Header in which the hosting proxy reports the visitor's address. Empty = no proxy. `true-client-ip` in `render.yaml` |
| `TURN_KEY_ID` | Implemented | Cloudflare TURN key id. Empty = STUN only |
| `TURN_KEY_API_TOKEN` | Implemented | **Secret.** Cloudflare TURN API token. Must be set together with `TURN_KEY_ID` |
| `LOG_LEVEL` | Implemented | silent, fatal, error, warn, info, debug or trace. Default info |
| `NODE_ENV` | Implemented | Set to `production` on the host |

### Web (`apps/web/.env`). Public values only; everything here ends up in the browser
| Name | Purpose |
|---|---|
| `VITE_SERVER_URL` | Implemented. Server address. Optional in development (defaults to port 3001 on the same host); **required on Vercel**, where the build stops without it |

### GitHub repository variable
| Name | Purpose |
|---|---|
| `SERVER_URL` | Server address for the wake-up job. Until it is set, the job does nothing |

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
**Not deployed yet.** Server → Render free (Singapore), described in `render.yaml`. Web → Vercel Hobby, settings in `apps/web/vercel.json`. Relay → Cloudflare TURN. Step-by-step guide: [DEPLOYMENT.md](DEPLOYMENT.md).

Once deployed, record here: the web address, the server address, and the date.
