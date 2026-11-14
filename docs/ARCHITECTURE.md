# Bitsomeggle — Architecture

> Status: **Agreed design, not yet implemented.** Sections marked _(M#)_ arrive in that milestone.
> Reasons for each choice live in [DECISIONS.md](DECISIONS.md).

---

## 1. The big picture

Bitsomeggle has three moving parts:

1. **The web app** (React, runs in each user's browser). Shows the screens, owns the camera/mic, and sets up the video call.
2. **The server** (Node.js + Socket.IO, one instance). A matchmaker and message switchboard. It pairs people, tells each pair "you two are now in session X", and passes small messages between them. **Video never goes through it.**
3. **The WebRTC connection** (browser ↔ browser). After setup, audio and video flow directly between the two browsers. If a network blocks a direct path, they go through a **TURN relay** run by Cloudflare.

```
 Browser A (React SPA)                                   Browser B
 ┌──────────────────┐   wss: Socket.IO (signaling,      ┌──────────────────┐
 │ UI  ← chatMachine│   matchmaking, text, reports)     │                  │
 │ socket / media / │◄──────────────┐   ┌──────────────►│   same app       │
 │ peer services    │               ▼   ▼               │                  │
 └───────┬──────────┘        ┌────────────────┐         └───────┬──────────┘
         │                   │ Node server    │                 │
         │                   │ Matchmaker     │── HTTPS ──► Cloudflare TURN API
         │                   │ Session store  │   (mint short-lived ICE creds)
         │                   │ Rate limiter   │
         │                   └────────────────┘
         └═════ WebRTC audio/video: direct P2P, or via Cloudflare TURN ════┘
```

**Example:** Priya and Arjun both click Start. Their browsers open a WebSocket to the server and say "put me in the queue". The server pairs them and creates session `7f3c…`. It tells Priya "you're matched, you are the *polite* peer" and Arjun "you're matched, you are the *impolite* peer". Their browsers then exchange a few setup messages *through* the server (the "signaling"), and the video connects directly between them. When Priya types "hi", the text goes Priya → server → Arjun. The server checks that both are still in session `7f3c…` before passing it on.

### Deployment

| Piece | Where | Cost |
|---|---|---|
| Web app (static files) | Vercel Hobby | $0 |
| Server | Render free web service, Singapore region | $0 (sleeps after 15 min idle; woken by a ping before the daily window) |
| STUN | `stun.cloudflare.com` | $0, unlimited |
| TURN relay | Cloudflare Realtime TURN | $0 up to 1,000 GB/month, then $0.05/GB |

The site is only **open for a 3–4 hour window each day** (configured in IST). Concentrating everyone into one window means people actually find each other.

---

## 2. Concepts you need (plain-language)

### 2.1 WebSocket and Socket.IO
Normal web requests are one question and one answer, after which the connection closes. A **WebSocket** stays open, so either side can send a message at any time. That's how the server can say "you've been matched!" the instant it happens. **Socket.IO** is a library on top of WebSockets. It adds named events (`socket.emit("queue:join")`), automatic reconnection, heartbeats (pings that detect dead connections), and **acks** (a reply callback, so the client knows the server received an event).

### 2.2 Why "synchronous" means "atomic" here
"Atomic" means *nobody can see or change things halfway through*. Imagine two people joining at the same moment, and both look at the queue and both grab the same waiting person. That's a **race condition**.

Node.js runs your JavaScript on **one thread with an event loop**. It takes one event (say, "socket A sent queue:join"), runs its handler **to completion**, then takes the next one. A handler can only be paused at an `await` (or a callback boundary). So:

```ts
// SAFE: no await inside — runs start-to-finish before any other event is handled
join(clientId) {
  if (this.isWaitingOrInSession(clientId)) return;   // check
  const partner = this.findPartner(clientId);         // look
  if (partner) this.createSession(clientId, partner); // change
  else this.queue.add(clientId);
}

// UNSAFE: the await lets another event run between "look" and "change"
async join(clientId) {
  const partner = this.findPartner(clientId);
  await somethingSlow();          // ← another join can grab the same partner here
  this.createSession(clientId, partner);
}
```

That's why **all `Matchmaker` methods are synchronous**. The socket handlers around them may be async (validating, minting TURN credentials, and so on), but the moment of "check queue → pair → record" happens in one uninterrupted step.

This works only while there is **one server process**. With two servers, each would have its own memory and its own queue. Then we'd need Redis with atomic Lua scripts. See DECISIONS.md D-005.

### 2.3 WebRTC, NAT, STUN and TURN
**WebRTC** is the browser's built-in technology for real-time audio/video between two browsers.

The difficulty is that most devices don't have a public address. Your laptop sits behind a router (or the campus network), which does **NAT**: it shares one public IP among many devices. Two browsers behind NATs can't simply "call" each other's address.

- **STUN** server: a tiny service that answers "here's what your public IP and port look like from outside". Each browser learns its public address and shares it as an **ICE candidate**. Often that's enough for a direct connection.
- **TURN** server: when a direct path is impossible (strict firewalls, symmetric NAT, UDP blocked, common on campus and corporate Wi-Fi), media is **relayed** through the TURN server. It costs bandwidth, which is why TURN is a paid/metered service. Cloudflare gives 1,000 GB/month free.
- **ICE** is the process of trying all candidate paths (direct, via STUN, via TURN) and picking the best one that works.
- **SDP** ("session description") is the text blob each side sends describing what media it wants to send and receive. One side makes an **offer**; the other replies with an **answer**.

Exchanging offers, answers and ICE candidates is called **signaling**. WebRTC doesn't say how to deliver them, so we send them through our Socket.IO server.

TURN needs a username and password. Our server asks Cloudflare's API for **short-lived credentials** (~4 h) and hands them to the browser at match time. The long-lived Cloudflare API key never leaves the server.

### 2.4 "Perfect negotiation" (polite and impolite peers)
If both browsers create an offer at the same time ("glare"), the setup breaks. That was a real bug in the old `reference/omegle_2027` code. The standard fix from the WebRTC spec authors is **perfect negotiation**:
- One peer is **polite**: on a collision, it backs off and accepts the other's offer.
- One peer is **impolite**: on a collision, it ignores the incoming offer and keeps its own.
- The server decides the roles when it creates the session (one of each), so the two never disagree.

Both peers can then use the same code, and renegotiation (for example, turning the camera back on) just works.

### 2.5 Session IDs as version numbers (stale events)
Every conversation gets a fresh random `sessionId`. Every in-session message in both directions carries it. Example of the problem it solves:

> Priya presses Next on Arjun and is instantly matched with Kabir. A moment later, a late ICE candidate or chat message from Arjun arrives. Without session IDs, Priya's browser would apply Arjun's message to the Kabir call.

With session IDs: the server drops any event whose `sessionId` isn't the sender's *current* session, and the client ignores any server event whose `sessionId` isn't its current one. Old events become harmless.

---

## 3. Server design

### 3.1 Modules
| Module | Responsibility | Knows about sockets? |
|---|---|---|
| `matchmaking/Matchmaker.ts` | Queue, sessions, client states, invariants. All methods synchronous. Returns a list of "effects" (e.g. `notify(A, matched…)`) instead of emitting directly | **No** |
| `matchmaking/findPartner.ts` | Pure function: given a candidate and the queue, choose a partner. **Extension point** for interest-based matching later | No |
| `socket/socketServer.ts` | The only place sockets and the Matchmaker meet. For each event: rate limit → validate (zod) → call the Matchmaker → deliver the returned effects. Handlers are never `async` | Yes |
| `app.ts` | Builds the whole server (HTTP + Socket.IO + Matchmaker) without listening. `index.ts` starts it; tests create private instances | Yes |
| `socket/rateLimit.ts` | Token buckets per socket per event type, plus generous per-IP limits | — |
| `turn/cloudflareTurn.ts` | Mints and caches short-lived ICE server credentials | — |
| `moderation/ModerationSink.ts` | Interface for reports and abuse events. v1 writes structured logs (no content); later could write to a DB | — |
| `schedule/openHours.ts` | "Is the site open now? When does it open or close?" (IST windows from config) | — |
| `config.ts` | Reads and validates env vars at startup; crashes early if something is missing | — |

Returning effects instead of emitting means the matchmaking logic can be tested with plain function calls. No real sockets are needed.

### 3.2 Matchmaking state
_Implemented in M1: `apps/server/src/matchmaking/`._
```ts
clients:  Map<ClientId, { id, state: 'idle' | 'waiting' | 'in_session', sessionId: string | null, lastPartner: ClientId | null, avoid: Set<ClientId> }>
queue:    Set<ClientId>        // JS Sets keep insertion order → first-in-first-out, O(1) delete
sessions: Map<SessionId, { id, a: ClientId, b: ClientId }>
```
`ClientId` is the server-side socket id. It is **never sent to other clients**.

### 3.3 Invariants (checked after every step in tests)
1. A client is in **at most one** of: the queue, one session.
2. `state === 'waiting'` ⇔ client is in `queue`.
3. `state === 'in_session'` ⇔ `sessionId` points to a session that lists this client.
4. Every session has **exactly two distinct** members, and both point back to it.
5. Nobody is matched with themselves.
6. Ending a session updates **both** members in the same synchronous step.
7. No two clients are left waiting if they could be matched with each other.

`Matchmaker.assertInvariants()` checks all of these. Tests call it after every operation.

### 3.4 Operations
Every operation returns a list of **effects**: `waiting`, `matched{sessionId, polite}` or `session_ended{sessionId, reason}`, each addressed to one client. An operation on a client id the Matchmaker doesn't know does nothing.

| Operation | Behavior |
|---|---|
| `connect(c)` | Register as `idle`. A second connect for the same id is a no-op |
| `join(c)` | If already `waiting` or `in_session` → no-op (idempotent: duplicate clicks or events are harmless). Otherwise `findPartner`; if found → create session; else → enqueue |
| `next(c, sessionId, {avoidPartner?})` | **In that session** → end it (partner gets `session_ended{reason:'partner_next'}` and becomes `idle`), then queue or match c. **In a different, newer session** → stale request, ignored (a double click can never skip a partner you haven't seen). **Idle** (partner already left) → same as `join`. **Waiting** → no-op. `avoidPartner` also puts the skipped partner on c's avoid list (used by "Report & skip" in M7) |
| `leave(c)` | Leave the queue or end the current session (partner gets `reason:'partner_left'`), become `idle`. Takes no session id: see DECISIONS D-019 |
| `disconnect(c)` | Remove from queue and from any session (partner gets `reason:'partner_disconnected'`), delete client |
| `getPartner(c, sessionId)` | The partner's id, but only if `sessionId` is c's **current** session. The relay layer (M2) uses this, so a late message from an old conversation is never delivered |
| `findPartner(c, waiting)` | Oldest waiting client that is not `c` and not avoided in either direction. Prefer someone who wasn't `c`'s last partner, but allow the last partner if nobody else is eligible (important when only 2–3 people are online; see D-020) |

Only the **partner** receives `session_ended`. The client who pressed Next or Leave already knows, and learns its new state from the `waiting`/`matched` effect.

**After a partner leaves**, you see "Stranger left" with a Next button. You are **not** automatically re-queued, so you stay in control of when your camera goes to a new person. The person who *pressed* Next is re-queued immediately.

### 3.5 Disconnects, heartbeats, restarts
- **Clean disconnects** (tab closed, Leave) are seen immediately. The partner gets `session:ended{reason:'partner_disconnected'}`.
- **Heartbeats:** the server pings every 10 s and waits up to 10 s for the reply (Socket.IO's defaults are 25 s and 20 s). A browser that vanishes without saying goodbye (laptop lid closed, Wi-Fi lost) is removed within about 20 s.
- **Reconnect grace** _(M6)_: Socket.IO "connection state recovery" lets a client that drops for under ~10 s come back with the same id. The video keeps flowing during a signaling blip, because media is peer-to-peer. Until M6, a disconnect ends the session immediately.
- **Server restart / deploy:** all in-memory state is lost and all sockets drop. Clients show "Connection lost, tap to rejoin". This is acceptable because nothing needs to survive, and live calls would be lost anyway.

### 3.6 Opening hours
_Implemented in M2: `apps/server/src/schedule/openHours.ts`._
- Config: `OPEN_WINDOWS`, a comma-separated list of daily windows in IST on a 24-hour clock, e.g. `21:00-00:30`. A window may run past midnight. Empty means always open (the default for local development).
- IST is always UTC+5:30, so the calculation is plain arithmetic and doesn't depend on the server machine's time zone.
- On connect, each browser gets a `status` event: `{open, opensAt, closesAt, online}`. The landing page uses it for "opens in 2 h 10 min" and can flip itself to "closed" at `closesAt` without asking again.
- **While closed:** `queue:join` is refused with code `closed`. `session:next` ends the current call (the user asked for that) but finds nobody new, and also replies `closed`.
- **Calls in progress at closing time simply continue.** There are no timers and no forced endings (DECISIONS D-022).
- A scheduled ping (cron-job.org or GitHub Actions) hits `/health` ~10 min before opening to wake the free Render instance _(M5)_.

### 3.7 Protection limits
_Implemented in M2: `apps/server/src/socket/rateLimit.ts` and `socketServer.ts`._

Each connected browser has its own set of **token buckets** (explained in `rateLimit.ts`): a request type may burst a little, then is held to a steady rate.

| Request | Burst | Steady rate |
|---|---|---|
| `queue:join` | 5 | 1 / s |
| `session:next` | 3 | 1 / s |
| `leave` | 5 | 1 / s |
| `chat:send` | 5 | 2 / s |
| `signal` | 100 | 30 / s (call setup sends 20–40 small messages at once) |
| `media:state` | 6 | 2 / s |

- A refused request (rate limited or invalid) costs a **strike**. Strikes have their own bucket (30, refilling one every 5 s). A browser that runs out is disconnected.
- A single message larger than **32 KB** closes that connection.
- At most `MAX_CLIENTS` (default 1000) browsers may be connected. Extra connections are refused with `server_full`.

---

## 4. Event contract
_Implemented in M2. The source of truth is `packages/shared/src/events.ts`; this section is a summary._

Client-to-server payloads are **zod schemas**, checked on the server for every message. Both sides import the same file, so the TypeScript types always match.

**Replies (acks).** Requests marked "ack" get a reply: `{ok: true}` or `{ok: false, code}`.

| Code | Meaning |
|---|---|
| `invalid` | Payload didn't match the schema |
| `rate_limited` | Too many requests too quickly |
| `closed` | Outside opening hours |
| `not_in_session` | The message named a session the sender isn't in (any more) |

### Client → Server
| Event | Payload | Reply | Notes |
|---|---|---|---|
| `queue:join` | none | ack | Start looking. Harmless if repeated |
| `session:next` | `{sessionId}` | ack | End that session (if it's the current one) and look again |
| `leave` | none | ack | Leave the queue or end the current session, go idle (D-019) |
| `chat:send` | `{sessionId, text}` | ack | Text is trimmed; 1–1000 characters |
| `signal` | `{sessionId, description}` or `{sessionId, candidate}` | none | WebRTC call setup; relayed to the partner only |
| `media:state` | `{sessionId, audio, video}` | none | So the partner can show "camera off" |

### Server → Client
| Event | Payload |
|---|---|
| `status` | `{open, opensAt, closesAt, online}` (sent on connect) |
| `queue:waiting` | none |
| `session:matched` | `{sessionId, polite}` (`iceServers` is added in M4/M5) |
| `session:ended` | `{sessionId, reason: 'partner_next' \| 'partner_left' \| 'partner_disconnected'}` |
| `chat:message` | `{sessionId, text, at}` |
| `signal` | same as the client's payload |
| `media:state` | `{sessionId, audio, video}` |
| `server:error` | `{code}`: a request **without** an ack was refused |

**Rules:**
- No partner identity or socket id is ever sent. `sessionId` is an opaque random UUID; knowing it gives no power, because membership is checked against server state.
- A relay event (`chat:send`, `signal`, `media:state`) is passed on only if it names the sender's **current** session.
- A late `signal` or `media:state` for a session that has just ended is dropped silently. That's normal traffic (it was already on its way), not an error.
- Fields that aren't in the schema are removed before relaying.
- Not in the contract yet: `report` (M7).

---

## 5. Web app design

### 5.1 Modules
_Text-only version implemented in M3. Video parts arrive in M4._

| Module | Responsibility | Status |
|---|---|---|
| `state/chatMachine.ts` | Pure reducer: `(state, event) → state`. The single source of truth for which screen we're on. Unit-tested without a browser | M3 |
| `services/socket.ts` | Creates the Socket.IO client, typed with the shared contract; works out the server address | M3 |
| `hooks/useChat.ts` | Connects socket + reducer to React. Forwards server events to the reducer; sends user actions to both the reducer and the server. Makes no decisions itself | M3 |
| `components/` | `Landing` (with opening-hours countdown), `Waiting`, `Conversation`, `ChatPanel` | M3 |
| `services/localMedia.ts` | `getUserMedia` once at Start; mute/unmute; stop all tracks on Leave or tab close | M4 |
| `services/peer.ts` | One `RTCPeerConnection` per session; perfect negotiation; ICE restart once on failure | M4 |
| `e2e/` | Playwright tests that drive real browser windows against a real server | M3 |

### 5.2 UI state machine
The state has two independent parts.

**Connection:** `connecting → connected ⇄ reconnecting`, or `full` if the server is at capacity.

**Phase** (what the user is doing):
```
            Start                 matched
   idle ───────────► waiting ───────────────► in_session
    ▲                 ▲   ▲                    │      │
    │ Leave / Cancel  │   └────── Next ────────┘      │ partner ended it
    │ refused         │                               ▼
    └─────────────────┴────────── Next ────────── partner_left
```
- **Optimistic updates:** pressing Start or Next changes the screen immediately, before the server answers, so the app feels instant.
- **If the server says no** (closed, too fast, or no reply within 8 s), the app returns to the landing page with a notice **and sends `leave`**, so the server also forgets us. The two sides can't disagree about whether we're in a chat.
- **Late server events are filtered.** `waiting` and `matched` are applied only while the user is waiting or in a chat. `session:ended` and incoming messages are applied only if they name the current session. Example: you press Cancel a split second after the server matched you. The `matched` event arrives while you're on the landing page and is ignored; your `leave` then ends that session on the server.
- **While the user wants a chat, the server's latest word wins.** If it reports a newer session than the one on screen, the screen follows.
- **Connection lost:** any chat is over (a new connection is a fresh start on the server), and the landing page says why. Socket.IO reconnects by itself.
- **partner_left** keeps the old messages readable but the message box is disabled. Messages are cleared on Next, Leave or a new match.
- **Opening hours:** the landing page works out open/closed from the last `status` and a 1-second clock, so it flips at the right moment without asking the server. The server still refuses a Start while closed.
- _M4 adds:_ `requesting_media` and `media_error` before waiting.

### 5.3 Media lifecycle
- **Permission is requested at Start.** Camera and mic access is required to enter, because it's a video app. If denied → `media_error` screen explaining how to re-enable it in the browser.
- **Tracks are kept across Next.** No re-prompt and no camera flicker. Only the `RTCPeerConnection` is replaced.
- **Leave / tab close** → `track.stop()` on every track (camera light goes off), close the peer connection, disconnect cleanly.
- **Camera/mic toggles** set `track.enabled = false/true` and emit `media:state`, so the partner sees a "Camera off" or "Muted" placeholder.
- **Connection failure:** ICE restart once → if still failing, end the session and re-queue. A media failure never corrupts matchmaking state.
- **Chat messages are cleared** whenever the session changes.

### 5.4 Layout
Remote video large, local video small (picture-in-picture), text chat panel always visible (side panel on desktop, bottom sheet on mobile), and Next as the most prominent button.

---

## 6. Security, privacy and moderation

| Concern | Measure |
|---|---|
| Malformed / spoofed events | zod validation on every event; membership derived from server state; unknown events dropped |
| Spam / rapid Next | Token buckets per socket per event (§3.7); repeated bad requests get the socket disconnected; button disabled until ack _(M3)_ |
| Shared campus IP | **No same-IP exclusion.** Per-IP limits are generous and only for flood protection |
| Joining arbitrary sessions | Impossible by design: the server decides who's in which session; clients can't name one to join |
| Secrets | Server env vars only. Browser gets only short-lived TURN credentials. No `VITE_`-prefixed secrets |
| Logging | Event types + random ids only. **Never** chat text, SDP, ICE candidates or IPs |
| Cross-site use | CORS allow-list = the frontend origin only |
| Reports _(M7)_ | "Report & skip": ends session, adds partner to the reporter's avoid list for the window, emits a `ModerationSink` event. Several distinct reporters → temporary cooldown for that socket |
| Honest limit | With no identity, a determined abuser can reconnect. Moderation can only slow people down |

---

## 7. Scaling path (not needed now)
1. Upgrade the single instance (Render Starter $7/mo, or Fly.io Mumbai ~$2–3/mo) if the 0.1-CPU free tier lags under load.
2. Multiple instances → Socket.IO Redis adapter + Redis-backed matchmaking with atomic Lua scripts, behind the same `Matchmaker` interface.
3. Persistent reports/bans → free Postgres (Neon/Supabase).
