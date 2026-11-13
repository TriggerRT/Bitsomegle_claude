# Bitsomeggle — Project Status

_Last updated: 2026-11-13 (after M0)_

## Phase
**M0 (repo tooling) complete.** Next: **M1: matchmaking core** (see [TODO.md](TODO.md)).

## What exists
| Item | Status |
|---|---|
| Product brief ([MASTER_PROMPT.md](MASTER_PROMPT.md)) | Done |
| Architecture ([ARCHITECTURE.md](ARCHITECTURE.md)) | Agreed design, not implemented |
| Decision log ([DECISIONS.md](DECISIONS.md)) | D-001 … D-018 |
| `CLAUDE.md` (repo root) | Done |
| Git repository | Initialised (branch `main`), **nothing committed yet**, no GitHub remote yet |
| npm workspaces: `packages/shared`, `apps/server`, `apps/web` | Implemented, tested |
| Server skeleton: `GET /health`, `PORT` config, graceful shutdown | Implemented, tested (unit + integration tests; dev and compiled modes started and queried by hand) |
| Web skeleton: placeholder page using a shared constant | Implemented; build verified. No tests yet (start in M3) |
| Tooling: TypeScript 7, Biome, vitest 5, Vite 8 | Implemented; lint/typecheck/build/test all pass after a clean `npm ci` |
| GitHub Actions CI (Node 22 + 24) | Implemented, **untested**: runs only after the repo is pushed to GitHub |

## Feature status
Status words: Implemented / Tested / Partially tested / Untested / Needs manual test / Blocked.

| Feature | Status |
|---|---|
| Anonymous random matchmaking | Not started |
| Session lifecycle + stale-event guards | Not started |
| Text chat | Not started |
| Video/audio (WebRTC P2P) | Not started |
| Next button | Not started |
| Waiting / matched / partner-left states | Not started |
| TURN relay | Not started |
| Opening-hours window | Not started |
| Rate limiting | Not started |
| Report & skip / moderation hooks | Not started |
| Deployment | Not started |

## Known issues / risks
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
