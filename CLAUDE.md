# CLAUDE.md — Bitsomeggle

Anonymous 1:1 video chat with random matching and a Next button, for BITS Pilani students.
The full product brief is in [docs/MASTER_PROMPT.md](docs/MASTER_PROMPT.md); read it before making architectural changes.

## Current phase
M0 (tooling) and M1 (matchmaking core in `apps/server/src/matchmaking/`, fully tested, not yet wired to sockets) are done. Next milestone: **M2, realtime server**. See [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) and [docs/TODO.md](docs/TODO.md).

## Stack (decided — see docs/DECISIONS.md for reasons)
- **Web:** Vite + React + TypeScript SPA → Vercel (free).
- **Server:** Node.js (≥22.12; 24 LTS in production) + TypeScript 7 + Socket.IO 4.8, `zod`, `pino` → Render free tier (Singapore). Socket.IO/zod/pino get added in M2.
- **Media:** raw WebRTC peer-to-peer, "perfect negotiation" pattern; Cloudflare STUN + TURN (credentials minted by the server).
- **Text chat:** relayed through Socket.IO (never stored, never logged).
- **State:** in-memory on a single server instance. No Redis, no database (yet).
- **Tests:** vitest (unit + simulated-client integration), Playwright with Chromium fake camera/mic.
- **Tooling:** npm workspaces, Biome (lint + format), GitHub Actions CI.

## Folder map (M0 created the skeleton; most folders inside fill up from M1 on)
```
docs/                 project documents (keep these up to date)
packages/shared/      zod event schemas + types — the single client/server contract
apps/server/          matchmaking/ (pure logic), socket/ (handlers, rate limits), turn/, moderation/, schedule/
apps/web/             state/chatMachine.ts, services/ (socket, localMedia, peer), hooks/, components/, e2e/
reference/            OLD code from previous attempts — read-only
```

## Commands (run from the repo root)
Node ≥ 22.12 required (CI also tests Node 24, the production target).
| Command | What it does |
|---|---|
| `npm install` | Install all workspaces (exact versions; `.npmrc` has `save-exact`) |
| `npm run dev:server` | Server with auto-restart on save (tsx), port 3001, `GET /health` |
| `npm run dev:web` | Web app dev server (Vite), http://localhost:5173 |
| `npm test` / `npm run test:watch` | All vitest tests (projects listed in root `vitest.config.ts`) |
| `npm run test:coverage` | Tests plus a report of which lines they ran |
| `npm run typecheck` | `tsc` in every workspace (no output files) |
| `npm run lint` / `npm run format` | Biome check / auto-fix (Markdown and `reference/` are excluded) |
| `npm run build` | Build shared → server → web (in that order) into each `dist/` |
| `npm run check` | lint + typecheck + test (run before saying something is done) |
| `npm start -w @bitsomeggle/server` | Run the compiled server (after `npm run build`) |

## How the packages connect (important, easy to get wrong)
- Inside a package, import with the **`.ts` extension**: `import { x } from './foo.ts'`. `rewriteRelativeImportExtensions` turns it into `.js` in `dist/`.
- `@bitsomeggle/shared` has a custom **`"source"` export condition** pointing at `src/index.ts`. Dev tools (editor/tsc, tsx `--conditions=source`, Vite, vitest) load the TypeScript source directly, so there's no rebuild after editing shared. Production (`node dist/…`) doesn't use that condition and loads `shared/dist`, which is why `build` builds shared first.
- Each Node package has two tsconfigs: `tsconfig.json` (editor + typecheck, includes tests, emits nothing) and `tsconfig.build.json` (compiles `src/` to `dist/`).
- A new test project must be added to `projects` in the root `vitest.config.ts`.

## Hard rules
1. **Never edit anything in `reference/`.** It is inspiration only; evaluate before reusing any idea. It contains a leaked secret in `.env.local` files: never copy, print or commit those files. `.gitignore` excludes `reference/**/.env*`, `reference/**/*.zip`, and `reference/omegle_2027/app-8fdlxwxjrytd/` (an embedded git repo, so git can't track it).
2. **Matchmaker methods are synchronous.** Any change to `matchmaking/` must keep the randomized test (`Matchmaker.fuzz.test.ts`) passing. No `await` between reading and changing matchmaking state. This is what makes matching atomic (see ARCHITECTURE.md → "Why synchronous = atomic").
3. **Every in-session event carries `sessionId`** in both directions. Server drops events whose `sessionId` is not the sender's current session; client ignores events for any session other than its current one.
4. **Membership comes from server state, never from the client.** Never send a partner's socket id or any identity to a client.
5. **Validate every incoming socket payload with the zod schemas in `packages/shared`.** Unknown or malformed → drop + rate-limit, never crash.
6. **Never log chat text, SDP, ICE candidates or IP addresses.** Log event types and random ids only.
7. **Secrets only in server env vars.** Nothing secret may use a `VITE_` prefix (those are bundled into the browser).
8. Business logic (`matchmaking/`, `chatMachine.ts`, `services/`) must not import React or socket handlers.
9. Do not add Redis, a database, auth, or new paid services without updating DECISIONS.md and asking the user.
10. Out of scope unless the user asks: accounts, profiles, history, friends, native apps, admin dashboards.

## Working with the user
- The user is a student who is still learning. **Explain important decisions in plain language**: concept first, why we need it, how we use it, a Bitsomeggle example. Explain jargon.
- Give honest technical pushback; recommend one option when there are trade-offs.
- Status words are strict: **Implemented / Tested / Partially tested / Untested / Needs manual test / Blocked**. Never say something works without having run it.
- For anything needing real devices (camera, mobile, campus Wi-Fi), write a step-by-step manual checklist (what to do, what they should see, what to report back) and mark it "Needs manual test" until the user confirms.

## Keep the docs current
After any meaningful change, update the relevant files in `docs/`:
- `PROJECT_STATUS.md` — what exists, what's tested, known bugs, env vars.
- `ARCHITECTURE.md` — when structure, flows or the event contract change.
- `DECISIONS.md` — add an entry for every non-trivial technical decision (never rewrite history; supersede instead).
- `TODO.md` — tick items, add new ones.
