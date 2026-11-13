# Bitsomeggle — Project Status

_Last updated: 2026-11-13 (after M1)_

## Phase
**M1 (matchmaking core) complete.** Next: **M2: realtime server** (see [TODO.md](TODO.md)).

## What exists
| Item | Status |
|---|---|
| Product brief ([MASTER_PROMPT.md](MASTER_PROMPT.md)) | Done |
| Architecture ([ARCHITECTURE.md](ARCHITECTURE.md)) | Agreed design; §3.2–3.4 (matchmaking) implemented |
| Decision log ([DECISIONS.md](DECISIONS.md)) | D-001 … D-021 |
| `CLAUDE.md` (repo root) | Done |
| Git repository | Branch `main`, pushed to private GitHub repo `TriggerRT/Bitsomegle_claude` |
| npm workspaces: `packages/shared`, `apps/server`, `apps/web` | Implemented, tested |
| Server skeleton: `GET /health`, `PORT` config, graceful shutdown | Implemented, tested (unit + integration tests; dev and compiled modes started and queried by hand) |
| Matchmaking core: `Matchmaker`, `findPartner` (`apps/server/src/matchmaking/`) | Implemented, tested. Not yet connected to sockets (M2) |
| Web skeleton: placeholder page using a shared constant | Implemented; build verified. No tests yet (start in M3) |
| Tooling: TypeScript 7, Biome, vitest 5, Vite 8 | Implemented; lint/typecheck/build/test all pass after a clean `npm ci` |
| GitHub Actions CI (Node 22 + 24) | Implemented, tested: both jobs green on the first push (confirmed by user) |

## Feature status
Status words: Implemented / Tested / Partially tested / Untested / Needs manual test / Blocked.

| Feature | Status |
|---|---|
| Anonymous random matchmaking | Logic implemented and tested (M1); not reachable over the network until M2 |
| Session lifecycle + stale-event guards | Server-side logic implemented and tested (M1); socket wiring in M2, client side in M3 |
| Text chat | Not started |
| Video/audio (WebRTC P2P) | Not started |
| Next button | Not started |
| Waiting / matched / partner-left states | Not started |
| TURN relay | Not started |
| Opening-hours window | Not started |
| Rate limiting | Not started |
| Report & skip / moderation hooks | Not started |
| Deployment | Not started |

## Test evidence (M1)
- 57 tests pass (`npm test`), 47 of them for matchmaking.
- Unit tests cover every matchmaking case in MASTER_PROMPT Part 9.
- Randomized test: 2,000 seeded sequences × 150 operations (300,000 operations). After each one it checks the invariants and that a simulated browser, updated only from effects, agrees with the server.
- Bug-injection check: 9 deliberate bugs were added one at a time (stale guard removed, partner left in queue, half-ended session, duplicate join, ghost left in queue, two impolite peers, avoid list ignored, fallback removed, client not deleted). The tests failed for all 9. The original code was then restored.
- Coverage of `matchmaking/`: every line of real logic runs in tests. The only lines not run are the "this should never happen" alarms.

## Known issues / risks
- With only two people online, skipping each other re-pairs them immediately (D-020, by design for now).
- ⚠️ **Leaked secret in old code:** `reference/omegle_2077…/web/.env.local` contains a real ZegoCloud server secret (it was also exposed to browsers through a `NEXT_PUBLIC_` variable). **Action for the user:** rotate it or delete that ZegoCloud project. Since M0, `.gitignore` excludes `reference/**/.env*` and the zip; a `git add` dry run confirmed no env file, zip or `node_modules` would be staged.
- Render free tier: 0.1 CPU. Unknown whether it handles ~300 concurrent sockets smoothly → measured in M6.
- Campus Wi-Fi may block UDP → relies on TURN over TLS on port 443. Confirmed only by manual testing in M5.
- Cloudflare TURN sign-up may require a card (to check in M5).

## Environment variables (planned)
### Server (`apps/server/.env`, never committed)
| Name | Purpose |
|---|---|
| `PORT` | HTTP/WebSocket port (Render sets this) |
| `CORS_ORIGIN` | Allowed frontend origin(s), e.g. `https://bitsomeggle.vercel.app` |
| `OPEN_WINDOWS` | Daily opening windows in IST, e.g. `21:00-00:30` |
| `CLOSING_GRACE_MINUTES` | Minutes existing calls may continue after closing |
| `CLOUDFLARE_TURN_KEY_ID` | Cloudflare TURN key id (secret) |
| `CLOUDFLARE_TURN_API_TOKEN` | Cloudflare TURN API token (secret) |
| `TURN_CREDENTIAL_TTL_SECONDS` | Lifetime of minted TURN credentials (~14400) |
| `LOG_LEVEL` | pino log level |

### Web (`apps/web/.env`). Public values only; everything here ends up in the browser
| Name | Purpose |
|---|---|
| `VITE_SERVER_URL` | Socket.IO server URL (`http://localhost:3001` in dev, `https://…onrender.com` in prod) |

## Local setup
```
npm install
npm run check        # lint + typecheck + tests
npm run dev:server   # http://localhost:3001/health
npm run dev:web      # http://localhost:5173
```
Node ≥ 22.12 required. Node 24 LTS recommended (production target).

## Deployment
Not deployed. Plan: server → Render free (Singapore); web → Vercel Hobby; scheduled ping before the daily window. See ARCHITECTURE.md §1.
