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
| `socket/handlers.ts` | Validates payloads (zod), applies rate limits, calls the Matchmaker, performs the returned effects (emit events) | Yes |
| `socket/rateLimit.ts` | Token buckets per socket per event type, plus generous per-IP limits | — |
| `turn/cloudflareTurn.ts` | Mints and caches short-lived ICE server credentials | — |
| `moderation/ModerationSink.ts` | Interface for reports and abuse events. v1 writes structured logs (no content); later could write to a DB | — |
| `schedule/openHours.ts` | "Is the site open now? When does it open or close?" (IST windows from config) | — |
| `config.ts` | Reads and validates env vars at startup; crashes early if something is missing | — |

Returning effects instead of emitting means the matchmaking logic can be tested with plain function calls. No real sockets are needed.

### 3.2 Matchmaking state
```ts
clients:  Map<ClientId, { state: 'idle' | 'waiting' | 'in_session', sessionId?: string, lastPartner?: ClientId, avoid: Set<ClientId> }>
queue:    Set<ClientId>        // JS Sets keep insertion order → first-in-first-out, O(1) delete
sessions: Map<SessionId, { a: ClientId, b: ClientId, startedAt: number }>
```
`ClientId` is the server-side socket id. It is **never sent to other clients**.

### 3.3 Invariants (checked after every step in tests)
1. A client is in **at most one** of: the queue, one session.
2. `state === 'waiting'` ⇔ client is in `queue`.
3. `state === 'in_session'` ⇔ `sessionId` points to a session that lists this client.
4. Every session has **exactly two distinct** members, and both point back to it.
5. Nobody is matched with themselves.
6. Ending a session updates **both** members in the same synchronous step.

### 3.4 Operations
| Operation | Behavior |
|---|---|
| `connect(c)` | Register as `idle` |
| `join(c)` | If already `waiting` or `in_session` → no-op (idempotent: duplicate clicks or events are harmless). Otherwise `findPartner`; if found → create session; else → enqueue |
| `next(c, sessionId)` | If `sessionId` is c's current session → end it (partner gets `session:ended{reason:'partner_next'}` and becomes `idle`). **Then** ensure c is queued / matched (same as `join`). If `sessionId` is stale → just `join(c)`. So if both press Next at once: the first Next ends the session, the second just queues that user |
| `leave(c, sessionId?)` | End current session if it matches (partner notified), remove from queue, become `idle` |
| `disconnect(c)` | Remove from queue and from any session (partner notified `reason:'partner_disconnected'`), delete client |
| `findPartner(c, queue)` | Oldest waiting client that is not `c`, not in `c.avoid` (and `c` not in theirs). Prefer not `lastPartner`, but allow it if nobody else is waiting (important when only 2–3 people are online) |

**After a partner leaves**, you see "Stranger left" with a Next button. You are **not** automatically re-queued, so you stay in control of when your camera goes to a new person. The person who *pressed* Next is re-queued immediately.

### 3.5 Disconnects, heartbeats, restarts
- **Heartbeats:** Socket.IO pings every ~10 s (tuned from the 25 s default) so a closed laptop drops out of the queue quickly.
- **Reconnect grace** _(M6)_: Socket.IO "connection state recovery" lets a client that drops for under ~10 s come back with the same id. The video keeps flowing during a signaling blip, because media is peer-to-peer. Until M6, a disconnect ends the session immediately.
- **Server restart / deploy:** all in-memory state is lost and all sockets drop. Clients show "Connection lost, tap to rejoin". This is acceptable because nothing needs to survive, and live calls would be lost anyway.

### 3.6 Opening hours
- Config: list of windows in IST, e.g. `OPEN_WINDOWS="21:00-00:30"`.
- Outside a window: `queue:join` is refused with `error{code:'closed'}`, and `GET /status` + the `status` event tell the landing page when it opens (countdown).
- At closing time: no new matches; existing calls get a grace period (e.g. 10 min), then end.
- A scheduled ping (cron-job.org or GitHub Actions) hits `/health` ~10 min before opening to wake the free Render instance.

---

## 4. Event contract

Defined once as **zod schemas in `packages/shared/src/events.ts`**. Both server and client import the same file, so the TypeScript types always match.

### Client → Server
| Event | Payload | Notes |
|---|---|---|
| `queue:join` | `{}` | ack → `{ok}` or `{ok:false, code}` |
| `queue:leave` | `{}` | |
| `session:next` | `{sessionId}` | end current (if matches) + re-queue |
| `session:leave` | `{sessionId}` | end current, go idle |
| `signal` | `{sessionId, description?}` or `{sessionId, candidate?}` | relayed to partner only |
| `chat:send` | `{sessionId, clientMsgId, text}` | text 1–1000 chars; ack → `{ok}` |
| `media:state` | `{sessionId, audio:boolean, video:boolean}` | so partner can show "camera off" |
| `report` | `{sessionId, reason}` | reason from a fixed list _(M7)_ |

### Server → Client
| Event | Payload |
|---|---|
| `status` | `{open, opensAt, closesAt, online}` |
| `queue:waiting` | `{}` |
| `session:matched` | `{sessionId, polite:boolean, iceServers}` |
| `session:ended` | `{sessionId, reason: 'partner_next' \| 'partner_left' \| 'partner_disconnected' \| 'closing' \| 'moderation'}` |
| `signal` | `{sessionId, description? / candidate?}` |
| `chat:message` | `{sessionId, text, at}` |
| `media:state` | `{sessionId, audio, video}` |
| `error` | `{code}` (`'rate_limited' \| 'closed' \| 'invalid' \| …`) |

**Rules:** no partner identity or socket id is ever sent. `sessionId` is an opaque random UUID; knowing it gives no power, because membership is checked against server state. Socket.IO `maxHttpBufferSize` is ~16 KB.

---

## 5. Web app design

### 5.1 Modules
| Module | Responsibility |
|---|---|
| `state/chatMachine.ts` | Pure reducer: `(state, event) → state`. The single source of truth for which screen we're on. Unit-tested without a browser |
| `services/socket.ts` | Socket.IO client; typed emit/on using the shared schemas |
| `services/localMedia.ts` | `getUserMedia` once at Start; mute/unmute; stop all tracks on Leave or tab close |
| `services/peer.ts` | One `RTCPeerConnection` per session; perfect negotiation; ICE restart once on failure; `close()` on session end |
| `hooks/useChat.ts` | Connects services + reducer to React |
| `components/` | `Landing`, `Waiting`, `CallView` (`VideoTile` ×2, `Controls`), `ChatPanel` (always visible during a call), `StatusBanner` |

### 5.2 UI state machine
```
idle ─Start→ requesting_media ─granted→ connecting ─→ waiting ─matched(sessionId, polite)→ in_call
  ▲               └denied→ media_error                   ▲                                 │
  └──── Leave ─────────────────────────────────────────── │ ◄── Next (re-queue) ────────────┤
                                                         partner_left ◄── session:ended ────┘
                      (any) ─socket lost→ reconnecting ─fail→ error
```
Also: `closed` (outside opening hours, with countdown).

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
| Spam / rapid Next | Token buckets per socket per event (e.g. Next: burst 3, 1/s; chat: burst 5, 2/s); button disabled until ack |
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
