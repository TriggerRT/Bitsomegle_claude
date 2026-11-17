# Bitsomeggle — Project Status

_Last updated: 2026-11-16 (M7 code done; not deployed, manual tests pending)_

## Phase
**M5 is complete:** the beta is online at https://bitsomegle-claude.vercel.app with the relay working, and all ten M5 manual tests are confirmed.

**M6 (reliability) is deployed and nearly complete.** Manual testing found a real fault (a call did not survive a real Wi-Fi drop); it was fixed (D-042), deployed, and the user confirmed M6-1, M6-2 and M6-3 on real networks afterwards. M6-4 and the live load test (M6-6) are confirmed too: the free plan is enough for 300 people (D-043). **One test is left: M6-5, a server restart with people online** ([MANUAL_TESTS.md](MANUAL_TESTS.md)). 

**M7 (safety and polish): the code is written and tested locally, but not committed, pushed or deployed.** Report and skip, a cooldown after several reports, rules and a people-here line on the landing page, a smaller web bundle, and browser tests for the closed and full screens. Still open: deploy, then manual tests M7-1 to M7-7 ([MANUAL_TESTS.md](MANUAL_TESTS.md)), and one decision for you: whether the landing page should state an age limit ([TODO.md](TODO.md)).

## What exists
| Item | Status |
|---|---|
| Product brief ([MASTER_PROMPT.md](MASTER_PROMPT.md)) | Done |
| Architecture ([ARCHITECTURE.md](ARCHITECTURE.md)) | Server (§3, §4) and web app (§5) implemented |
| Decision log ([DECISIONS.md](DECISIONS.md)) | D-001 … D-046 |
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
| TURN relay credentials from Cloudflare (`apps/server/src/turn/`) | Implemented, tested with a stand-in for Cloudflare. With the real key on Render: credentials fetched, and a relay-only call connected (M5-3, confirmed by user 2026-11-14) |
| Per-IP connection cap (`apps/server/src/socket/ipLimit.ts`) | Implemented, tested. Render does send `true-client-ip` (seen in the live log, M5-4). The cap itself has not been reached on the live server |
| Relay test switch (`?relay=1`) | Implemented, tested |
| Reconnect grace: a call survives a short drop of the server connection (D-038, D-042) | Implemented, tested with drops the server is not told about (pretend browsers and real browser windows). The first version failed on a real network; after the fix the user confirmed M6-1, M6-2 and M6-3 on the live site (2026-11-16) |
| Rejoin after a server restart or long drop; "Reconnecting…" banner | Implemented, tested. Long drop confirmed by user (M6-3). A real server restart with people online: **needs manual test** (M6-5) |
| Rescue of a broken video call: one ICE restart (D-039) | Implemented, tested against a stand-in for the browser's call object. In M6-1 and M6-2 video came back on real networks; whether the rescue or the browser's own recovery did it was not observed |
| Video bitrate cap, 600 kbit/s (D-040) | Implemented, tested in Chromium |
| Stats log line once a minute (D-041) | Implemented, tested; seen in a local run |
| Load-test tool (`npm run loadtest`) | Implemented; run locally and against the live server with 300 users (D-043) |
| Report and skip, avoid list, cooldown after three different reporters (D-044, D-045) | Implemented, tested (matchmaker, server with pretend browsers, real browser windows). **Needs manual test** |
| Landing page rules and "people here right now" | Implemented, tested in browser windows; looked at on desktop and phone-size screens |
| Report dialog | Implemented, tested (button, Escape, focus returns). **Needs manual test** with a real phone and keyboard |
| Deployment files: `render.yaml`, `apps/web/vercel.json`, `.github/workflows/wake-server.yml` | Implemented. Render and Vercel both built and deployed from them (2026-11-14). The wake-up job is still inactive and **untested** |
| Deployment guide ([DEPLOYMENT.md](DEPLOYMENT.md)) | Followed by the user on real accounts (2026-11-14). Corrected where reality differed: Cloudflare asks for a card, and Vercel needed a different install command |

## Feature status
Status words: Implemented / Tested / Partially tested / Untested / Needs manual test / Blocked.

| Feature | Status |
|---|---|
| Anonymous random matchmaking | Tested end to end in real browser windows (M3) |
| Session lifecycle + stale-event guards | Tested on server and client |
| Text chat | Tested end to end (M3) |
| Video/audio (WebRTC P2P) | Tested end to end with a pretend camera (M4) and confirmed by the user with a real camera on one laptop. Between different networks: **needs manual test** after deployment |
| Next button | Tested end to end, no page reload (M3) |
| Waiting / matched / partner-left states | Tested end to end (M3). Closed-hours and server-full screens: tested in browser windows against a closed, nearly full test server (M7) |
| TURN relay | Working on the live site: relay-only calls connected, including from campus Wi-Fi (M5-3, M5-7, confirmed by user) |
| Opening-hours window | Server: tested. Countdown UI: tested in a browser window (M7). **Not tried on the live site**, where no opening hours are set |
| Rate limiting | Tested (M2). Numbers to be tuned after beta |
| Surviving connection drops | Confirmed by the user on real networks after the fix: Wi-Fi blip, Wi-Fi to mobile data, long drop (M6-1 to M6-3) |
| Report & skip / moderation hooks | Tested end to end in browser windows (M7). **Needs manual test** on real devices |
| Deployment | Live since 2026-11-14. Laptop, phone ↔ laptop and two-network calls confirmed by the user (M5-2, M5-5, M5-6) |

## Test evidence (M1)
- 57 tests pass (`npm test`), 47 of them for matchmaking.
- Unit tests cover every matchmaking case in MASTER_PROMPT Part 9.
- Randomized test: 2,000 seeded sequences × 150 operations (300,000 operations). After each one it checks the invariants and that a simulated browser, updated only from effects, agrees with the server.
- Bug-injection check: 9 deliberate bugs were added one at a time (stale guard removed, partner left in queue, half-ended session, duplicate join, ghost left in queue, two impolite peers, avoid list ignored, fallback removed, client not deleted). The tests failed for all 9. The original code was then restored.
- Coverage of `matchmaking/`: every line of real logic runs in tests. The only lines not run are the "this should never happen" alarms.

## Test evidence (M7)
- `npm run check` passes: lint, typecheck, **477 tests**. `npm run e2e`: **33 browser tests** pass. `npm run build` succeeds.
- New in M7:
  - Matchmaker: report ends the chat like a skip and never pairs the two again, even when nobody else is waiting; works for the chat that just ended and while already in a new one; refuses sessions that are not the reporter's. The randomized test now mixes reports into its 300,000 steps and checks that reported pairs never meet again.
  - Report tracker: three different reporters start a cooldown; one person repeating counts once; old reports expire; the cooldown ends by itself and is not extended by more reports; records of people who left are forgotten.
  - Server with pretend browsers: the reported person is told nothing about the report; reports are recorded once with ids and the reason only; refused reports record nothing; reports are rate limited; the cooldown removes the offender from a chat they had moved on to and refuses Start and Next for ten minutes.
  - Web app logic: report during a chat and after the partner left; the thank-you; the cooldown path releases the camera.
  - Real browser windows: report and skip, cancelling the dialog by button and by Escape with focus returning, reporting someone who left first, three reporters blocking a fourth window, the rules and the people-here line, "nobody else is online", and the closed and full screens.
- Bug-injection check: 40 deliberate bugs in the M7 code, all caught.
- Looked at by eye (screenshots at 1280×800 and 390×780): landing page with rules, call screen with the Report button, the dialog, the waiting screen with the thank-you, the "Reported" state.
- Web bundle after dropping the unused validation library: 285 KB, 89 KB compressed (was 365 KB, 111 KB).
- **Not verified:**
  - anything on the live site: M7 is not deployed;
  - real phones: the dialog, and typing with the on-screen keyboard open;
  - a screen reader. Keyboard use was tested for the dialog only;
  - whether three reporters in fifteen minutes is the right threshold. That needs real use.

## Test evidence (M6, after the fix was deployed, 2026-11-16)
- **Reported by the user on the live site:** M6-1 (Wi-Fi off for 3 s), M6-2 (Wi-Fi to mobile data) and M6-3 (30-second drop) **passed**. No timings or per-device details were given.
- **Not verified:** M6-5, a server restart while people are online. The user plans to do it later. The same code path (coming back as a brand-new connection) is covered by automated tests and by M6-3, but a real restart on Render has not been watched.

## Test evidence (M6, after the first manual tests, 2026-11-16)
- **Reported by the user on the live site:** M6-1 (Wi-Fi off for 3 s) and M6-2 (Wi-Fi to mobile data) **failed**: the "Reconnecting…" banner appeared, then the start page with "Your connection dropped, so the chat ended." M6-4 (closing the tab) passed. M6-3 and M6-5 were not reported.
- **Cause and fix:** D-042. `npm run check`: **411 tests** pass. `npm run e2e`: **25 browser tests** pass. `npm run build` succeeds.
- **The failure is now reproduced by tests.** Drops are simulated the way real networks fail (the server is not told). With the fix removed, 3 server tests and 3 browser tests fail; with it they pass. Four more deliberate bugs in the fix itself are caught (44 injected in M6 in total, all caught).
- **Load test against the live server (M6-6), run by Claude at the user's request:** 300 pretend users for 120 s. All connected; 5,054 chat requests, 1,138 joins, 865 Next presses, 18,009 call-setup messages; nothing refused, dropped or unanswered. Median answer 105 ms, 95% within 115 ms, 99% within 170 ms, slowest 421 ms. About 100 ms of that is the network trip to Singapore. The server's own stats lines for those two minutes (pasted by the user): 301 connected, about 140 calls, event-loop delay p99 1 to 2 ms, at most 102 ms, memory up to 123 MB. It was close to idle.
- **Not verified:**
  - **the fix on a real network.** It is not deployed. M6-1 and M6-2 must be repeated;
  - M6-3 (long drop) and M6-5 (server restart);
  - a real broken video call being rescued. In M6-1 and M6-2 the chat ended before that code could matter.

## Test evidence (M6, before deployment)
- `npm run check` passes: lint, typecheck, **407 tests**. `npm run e2e`: **25 browser tests** pass, twice in a row. `npm run build` succeeds.
- New in M6 (60 unit and integration tests, 7 browser tests):
  - Server, with pretend browsers whose connection is cut without a goodbye: a call is kept when they return in time; the give-up timer is cancelled; messages sent meanwhile are delivered; a partner's Next during the gap is learned on return; returning works even when the server is full; not returning ends the call for the partner after the grace period and not before; a late return is told `connection:reset` and can start again. No grace for people waiting, deliberate goodbyes, old copies of the app, or when switched off.
  - Web app logic: a drop keeps the chat on screen; a restored connection changes nothing; a new connection or a reset ends the chat with an explanation and releases the camera; someone waiting rejoins by themselves; Next, Leave and "camera allowed" while offline take effect on reconnect.
  - Call rescue (stand-in call object): the impolite side restarts once; the polite side never does; success, repeated failure, timeout, a 4-second interruption, and closing mid-rescue.
  - Real browser windows with the server connection cut on purpose: a short drop does not end the call and video keeps playing; a message sent to someone briefly offline arrives; the message box is disabled meanwhile; staying offline ends the chat for both and switches the camera off; someone waiting is still matched afterwards; navigating away tells the partner within a second; the sent video is limited to 600 kbit/s.
- Bug-injection check: 39 deliberate bugs. 37 were caught at once. Two exposed weak tests (a waiting person wrongly given a grace period; the status timer left running after shutdown); both tests were tightened and now catch them. **All 39 are caught.**
- **One-off check** (not in the suite, it takes 80 s): a call with no messages for 80 seconds, long enough for Socket.IO's once-a-minute clean-up to run, was still resumed after a drop. This is the case the regular status message exists for (D-038).
- **Load test, local only:** 300 pretend users for 75 s against a server on this laptop. All connected, 3,406 chat messages and 12,312 call-setup messages delivered, nothing refused, dropped or unanswered. Answer times: chat p95 2 ms, Next p95 3 ms, join p95 10 ms. The stats line showed 300 clients, 144 calls, 114 MB. **This says the tool works and the code has no obvious bottleneck. It says nothing about Render's much smaller machine.**
- **Not verified:**
  - anything on the live site: M6 is not deployed;
  - the load test against Render (the number that matters);
  - a real network drop, a real Wi-Fi-to-mobile switch, a real broken call being rescued (M6-1 to M6-3);
  - Firefox and Safari for the reconnect and bitrate code (browser tests run in Chromium only).

## Test evidence (M5)
- `npm run check` passes: lint, typecheck, **347 tests**. `npm run e2e`: **18 browser tests** pass.
- New in M5 (52 tests):
  - TURN credentials: the documented request is sent; credentials are replaced hourly; a failed refresh keeps the old ones and retries after a minute; expired ones are no longer handed out; five kinds of bad answer fall back to STUN; the API token and the credentials never appear in the log; nothing is scheduled after stop.
  - With a real server and pretend browsers: both matched browsers receive the relay; the API token is never sent to a browser; matching still works when Cloudflare is unreachable.
  - Per-IP cap: refuses above the cap, other addresses unaffected, the place is freed on disconnect, unknown addresses are not counted, a made-up header is ignored when no proxy is configured.
  - Settings: the two TURN values must come together; header name and cap are validated.
  - Browser: `?relay=1` makes that browser relay-only while the partner stays normal, and text chat still works when video can't connect.
- Bug-injection check: 23 deliberate bugs in the new code (for example: expired credentials still handed out, error details logged, per-IP place never freed, cap off by one, `?relay=1` ignored). **All 23 were caught.**
- **Rehearsal of Vercel's commands** in a clean copy (added after the first real build failed): installing from inside `apps/web` reproduced the failure; installing from the root built the site.
- **Rehearsal of Render's commands** in a clean copy of the repository, with `NODE_ENV=production`: the build command succeeded; the server refused to start without `CORS_ORIGIN`; with it, `/health` answered, the allowed website got a CORS header and another website did not.
- **One real request to Cloudflare** with a made-up key: Cloudflare answered 404, the server logged "Cloudflare refused" and started normally with STUN only. This shows the address is right and a refusal is handled. It does not show that real credentials work.
- **On the live site (2026-11-14):** `/health` answers (checked by Claude); the site sends the four security headers (checked by Claude); the Render log shows "TURN credentials refreshed", `turnRelay:true`, `perIpCap:500` and the header names `true-client-ip`, `cf-connecting-ip`, `x-forwarded-for`, with no IP addresses or chat text in the lines the user pasted. The user confirmed M5-2 (call on the deployed site), M5-3 (relay-only call), M5-5 (phone ↔ laptop) and M5-6 (two networks).
- **2026-11-16:** the user reported that the remaining tests passed: M5-7 (relay from campus Wi-Fi), M5-8 (other browsers), M5-9 (a real second person) and M5-10 (sleep and wake). The report was "all checks passed", without per-browser details or timings.
- **Not verified:** the per-IP cap being reached on the live server, the wake-up job, more than a handful of people online at once (M6 load test).

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
- **Reports cannot stop a determined offender.** Without accounts, reloading the page clears a cooldown (D-045). If reports turn out to be frequent, the real fix is a BITS email sign-in.
- The landing page makes no statement about age. Whether to add one is an open decision for the user (D-046).
- The people-here number includes people who are only looking at the landing page.
- When someone vanishes for good (laptop lid closed, tab killed), their partner now sees a frozen picture for up to 10 s longer than before (D-038). Leaving the page normally is still immediate.
- Chat and call-setup messages stay in the server's memory for up to about 90 s so they can be replayed after a reconnect. They are never written to disk or logged.
- With only two people online, skipping each other re-pairs them immediately (D-020, by design for now).
- ⚠️ **Leaked secret in old code:** `reference/omegle_2077…/web/.env.local` contains a real ZegoCloud server secret (it was also exposed to browsers through a `NEXT_PUBLIC_` variable). **Action for the user:** rotate it or delete that ZegoCloud project. Since M0, `.gitignore` excludes `reference/**/.env*` and the zip; a `git add` dry run confirmed no env file, zip or `node_modules` would be staged.
- A drop longer than about 15 s can still end the call even if the person returns within the server's waiting time, because Socket.IO can only replay messages it still remembers. Acceptable for now.
- Render free tier handled 300 simulated people (D-043). A real crowd arriving within one minute has not been simulated.
- **The Cloudflare relay is live and has no spending cap** (1,000 GB a month included, then $0.05 per GB, D-037). Check that the $1 budget alert exists (DEPLOYMENT part 1, step 4). Video is now capped at 600 kbit/s; the automatic cut-off is deferred (D-040).

## Environment variables
### Server (set in the host's dashboard in production; see `apps/server/.env.example`)
| Name | Status | Purpose |
|---|---|---|
| `PORT` | Implemented | HTTP/WebSocket port (Render sets this). Default 3001 |
| `CORS_ORIGIN` | Implemented | Web app address(es) allowed to connect, comma separated. **Required when `NODE_ENV=production`**. Default `http://localhost:5173` |
| `OPEN_WINDOWS` | Implemented | Daily opening windows in IST, e.g. `21:00-00:30`. Empty = always open |
| `MAX_CLIENTS` | Implemented | Cap on simultaneous connections. Default 1000 |
| `RECONNECT_GRACE_MS` | Implemented | How long a call is kept for someone whose connection dropped. Default 10000. 0 = off |
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
npm run loadtest     # 300 pretend users against a local server (start one with npm run dev:server)
```
To try it: run `npm run dev`, open http://localhost:5173 in two browser windows, press **Start chatting** in both.
Node ≥ 22.12 required. Node 24 LTS recommended (production target).

## Deployment
**Live since 2026-11-14.**
| Piece | Address |
|---|---|
| Web app (Vercel Hobby, settings in `apps/web/vercel.json`) | https://bitsomegle-claude.vercel.app |
| Server (Render free, Singapore, described in `render.yaml`) | https://bitsomeggle.onrender.com (health check: `/health`) |
| Relay | Cloudflare TURN, key held in Render's environment |

Opening hours are not set, so the site is always open. Step-by-step guide: [DEPLOYMENT.md](DEPLOYMENT.md).
