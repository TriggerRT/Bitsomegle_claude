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
| TURN relay | Cloudflare Realtime TURN | $0 for the first 1,000 GB each month, then $0.05/GB |

How to set these up, step by step: [DEPLOYMENT.md](DEPLOYMENT.md). The server is described for Render in `render.yaml`, and the web app's Vercel settings are in `apps/web/vercel.json`.

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

TURN needs a username and password. Our server asks Cloudflare's API for **short-lived credentials** and hands them to both browsers at match time. The long-lived Cloudflare API token never leaves the server. How the server keeps those credentials fresh is in §3.8.

### 2.4 Who offers first, and "perfect negotiation"
To start a call, one browser sends an **offer** and the other replies with an **answer**. In Bitsomeggle both browsers have a camera to share, so left alone both would send an offer at the same moment. Two offers crossing is called a collision, or "glare". That was a real bug in the old `reference/omegle_2027` code.

The server gives the two browsers opposite roles when it creates the session, one **polite** and one **impolite**, and we use them in two ways:

1. **The impolite side always makes the first offer. The polite side waits for it** and sends its camera and microphone in the answer. So a collision can't happen when a call starts.
2. **Later collisions** are handled by the standard "perfect negotiation" pattern from the WebRTC spec authors: the polite side drops its own offer and accepts the other one, and the impolite side ignores the incoming offer. Nothing in the app renegotiates today (the mic and camera buttons only pause tracks), so this is a safety net for future features.

Rule 1 exists because of something found while testing M4 (DECISIONS D-029): when the polite side has to abandon its own offer, Chromium stops gathering network routes for that connection and the call never connects. Avoiding the collision avoids the problem.

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
| `socket/rateLimit.ts` | Token buckets per socket per event type | — |
| `socket/ipLimit.ts` | Counts connections per IP address for the per-IP cap; works out the visitor's address behind the hosting proxy | — |
| `turn/iceServers.ts` | The `IceServerSource` interface (`getIceServers()` is synchronous) and the STUN-only source | — |
| `turn/cloudflareTurn.ts` | Fetches short-lived TURN credentials from Cloudflare in the background and keeps the latest in memory (§3.8) | — |
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
- A scheduled GitHub Actions job (`.github/workflows/wake-server.yml`) calls `/health` about 15 minutes before opening to wake the free Render instance. It does nothing until the repository variable `SERVER_URL` is set (DEPLOYMENT.md, part 6).

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
- **Per-IP cap** (`socket/ipLimit.ts`, M5): at most `MAX_CLIENTS_PER_IP` connections from one address (off by default; 500 on Render). It stops one computer from filling the server alone. It is deliberately generous because the whole campus can share one address (D-013). Behind Render's proxy the visitor's address is read from the header named in `CLIENT_IP_HEADER`. If that header is missing the connection is let in uncounted, and the server logs one warning. Addresses are held in memory only while their connections are open and are never logged.

### 3.8 TURN credentials
_Implemented in M5: `apps/server/src/turn/`._

**The problem:** handing the list of STUN/TURN servers to two matched browsers happens in the middle of delivering a match, and that code may never wait (§2.2). Asking Cloudflare for credentials takes a network round trip.

**The answer:** ask in the background and read from memory.
- At start-up the server asks Cloudflare once for credentials valid for **12 hours** (it waits at most 5 seconds for this before accepting visitors).
- It asks again **every hour**. So whatever a browser is given still has at least 11 hours left, longer than any opening window. This matters because Cloudflare cuts a relayed call when its credentials expire.
- `getIceServers()` only reads the latest answer. Everyone matched within the same hour receives the same credentials.
- **If Cloudflare can't be reached:** keep using the previous credentials while they are valid and retry every minute. With none at all, browsers get STUN only, so calls still work wherever a direct path exists.
- Without `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` (local development, tests) the server uses STUN only and never contacts Cloudflare.
- The API token and the credentials are never logged. A failed request logs only the HTTP status or the kind of error.

**Checking that the relay works:** two browsers connect directly whenever they can, so a working call doesn't prove the relay works. Opening the site as `…/?relay=1` makes that browser refuse direct paths (`iceTransportPolicy: 'relay'`). If its video still connects, the relay works.

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
| `session:matched` | `{sessionId, polite, iceServers}`. `iceServers` is the STUN/TURN list for the call (STUN, plus a TURN relay when the server has a Cloudflare key, §3.8) |
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
| Module | Responsibility |
|---|---|
| `state/chatMachine.ts` | Pure reducer: `(state, event) → state`. The single source of truth for which screen we're on, what's switched on, and the call status. Unit-tested without a browser |
| `services/chatController.ts` | Plain class, no React. Turns everything that happens into reducer events, then **reconciles**: makes the camera and the video call match the new state. Unit-tested with a fake socket, camera and call |
| `services/socket.ts` | Creates the Socket.IO client, typed with the shared contract; works out the server address |
| `services/localMedia.ts` | Asks for camera + microphone, maps browser errors to reasons, falls back to audio only, stops tracks |
| `services/peer.ts` | One `RTCPeerConnection` per session: who offers first, perfect negotiation, call state |
| `hooks/useChat.ts` | Creates a controller with the real services and re-renders React when it publishes a change |
| `components/` | `Landing`, `MediaSetup` (permission prompt and problems), `Waiting` (with self-preview), `Conversation`, `VideoTile`, `MediaControls`, `ChatPanel` |
| `e2e/` | Playwright tests that drive real browser windows, with Chromium's pretend camera, against a real server |

**Why a controller outside React (D-030).** The first call-setup message from the partner can arrive a few milliseconds after "you are matched". React runs its effects a little later, after drawing the screen. The controller reacts to each event immediately, so the call exists before the next message is handled.

**Reconcile.** After every event the controller compares the world with the state and fixes the difference:
1. Camera and microphone are held from Start until the user is back on the landing page. They stay on between partners.
2. Track on/off follows the mic and camera buttons.
3. Exactly one call exists while `in_session`, for that session id. Any other call is closed first.
4. The partner is told our mic/camera state once per change.

There is no separate "when X happens, also do Y" code, so nothing can be forgotten on an unusual path.

### 5.2 UI state machine
The state has two independent parts.

**Connection:** `connecting → connected ⇄ reconnecting`, or `full` if the server is at capacity.

**Phase** (what the user is doing):
```
  Start               allowed           matched
idle ──► requesting_media ──► waiting ──────────► in_session
               │               ▲  ▲                │    │
               │ refused       │  └───── Next ─────┘    │ partner ended it
               ▼               │                        ▼
          media_error          └──────── Next ──── partner_left
          (Try again → requesting_media)

Back to idle from any state: Leave, Cancel, Back, server refused, connection lost.
```
- **Optimistic updates:** pressing Start or Next changes the screen immediately, before the server answers, so the app feels instant.
- **If the server says no** (closed, too fast, or no reply within 8 s), the app returns to the landing page with a notice **and sends `leave`**, so the server also forgets us. The two sides can't disagree about whether we're in a chat.
- **Late server events are filtered.** `waiting` and `matched` are applied only while the user is waiting or in a chat. `session:ended` and incoming messages are applied only if they name the current session. Example: you press Cancel a split second after the server matched you. The `matched` event arrives while you're on the landing page and is ignored; your `leave` then ends that session on the server.
- **While the user wants a chat, the server's latest word wins.** If it reports a newer session than the one on screen, the screen follows.
- **Connection lost:** any chat is over (a new connection is a fresh start on the server), and the landing page says why. Socket.IO reconnects by itself.
- **partner_left** keeps the old messages readable but the message box is disabled. Messages are cleared on Next, Leave or a new match.
- **Opening hours:** the landing page works out open/closed from the last `status` and a 1-second clock, so it flips at the right moment without asking the server. The server still refuses a Start while closed.
- **Camera first (M4):** Start goes to `requesting_media`. Allowed → `waiting`. Refused or failed → `media_error` with a reason, where "Try again" asks again and "Back" returns to `idle`. Cancelling while the browser prompt is open wins over a late "Allow": the camera is switched straight off.
- **Per-session extras (M4):** `partnerMedia` (assumed on until the partner says otherwise), `call` (`connecting` / `connected` / `failed`) and `iceServers`. All reset for each new partner, and all ignore reports that name another session.
- **`localMedia` (my mic and camera choices) is not per session:** it carries over to the next partner.

### 5.3 Media lifecycle
_Implemented in M4._
- **Permission is requested at Start**, before joining the queue. Nobody is matched who can't take part.
- **Problems are explained.** Browser errors are mapped to five reasons (`denied`, `no_device`, `in_use`, `insecure`, `unknown`), each with its own instructions.
- **No camera is fine; no microphone is not.** If the device has no camera, the app retries with the microphone alone and the user joins with audio only. The partner sees "Stranger's camera is off."
- **Tracks are kept across Next.** No second prompt and no camera flicker. Only the `RTCPeerConnection` is replaced.
- **Leave, Cancel, a refused request or a lost connection** → every track is stopped (the camera light goes off) and the call is closed.
- **Mic and camera buttons** set `track.enabled`. A paused camera sends black frames and can resume instantly; the devices stay reserved until Leave. `media:state` tells the partner, who sees "Stranger's camera is off." or "Stranger is muted".
- **Picture size** is requested as 640×480 to keep calls smooth on weak Wi-Fi and TURN data use low.
- **Call states:** "Connecting video…" until connected. If no path is found the screen says so, **the chat stays open** and text still works; the user can press Next. A media failure never changes matchmaking state.
- _M6 adds:_ one automatic ICE restart before giving up.

### 5.4 Layout
- **Desktop:** partner's video large on the left with your own mirrored picture in its corner; text chat in a side panel on the right; Mute, Camera, Leave and Next under the video.
- **Narrow screens (under 800 px):** video on top, text chat underneath, the four buttons in one row.
- **Waiting screen:** your own camera preview, so you can check how you look before anyone sees you.

---

## 6. Security, privacy and moderation

| Concern | Measure |
|---|---|
| Malformed / spoofed events | zod validation on every event; membership derived from server state; unknown events dropped |
| Spam / rapid Next | Token buckets per socket per event (§3.7); repeated bad requests get the socket disconnected; button disabled until ack _(M3)_ |
| Shared campus IP | **No same-IP exclusion.** The per-IP connection cap is generous (half the server) and only for flood protection (§3.7) |
| Joining arbitrary sessions | Impossible by design: the server decides who's in which session; clients can't name one to join |
| Secrets | Server env vars only, typed into Render's dashboard and never stored in git. Browser gets only short-lived TURN credentials. No `VITE_`-prefixed secrets |
| Embedding the site in another page | The web host sends `X-Frame-Options: DENY` and a `Permissions-Policy` that allows camera and microphone for our own page only (`apps/web/vercel.json`) |
| Logging | Event types + random ids only. **Never** chat text, SDP, ICE candidates or IPs |
| Cross-site use | CORS allow-list = the frontend origin only |
| Reports _(M7)_ | "Report & skip": ends session, adds partner to the reporter's avoid list for the window, emits a `ModerationSink` event. Several distinct reporters → temporary cooldown for that socket |
| Honest limit | With no identity, a determined abuser can reconnect. Moderation can only slow people down |

---

## 7. Scaling path (not needed now)
1. Upgrade the single instance (Render Starter $7/mo, or Fly.io Mumbai ~$2–3/mo) if the 0.1-CPU free tier lags under load.
2. Multiple instances → Socket.IO Redis adapter + Redis-backed matchmaking with atomic Lua scripts, behind the same `Matchmaker` interface.
3. Persistent reports/bans → free Postgres (Neon/Supabase).
