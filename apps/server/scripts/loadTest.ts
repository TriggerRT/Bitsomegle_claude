/**
 * Load test: connects many pretend users to a Bitsomeggle server and reports how quickly
 * the server answers while they are all active.
 *
 * Each pretend user behaves roughly like a person: joins the queue, and once matched
 * sends the burst of call-setup messages a real browser would, chats every few seconds,
 * and presses Next after a while. No real video is sent (video never goes through our
 * server anyway), so this measures exactly the work our server does.
 *
 * Run from the repository root:
 *   npm run loadtest                                  (local server, 300 users, 60 s)
 *   npm run loadtest -- --url https://example.onrender.com --clients 300 --seconds 120
 *
 * IMPORTANT when aiming at the live site: real visitors who are online will be matched
 * with these pretend users (and see "Connecting video…" until they press Next). Run it
 * when nobody is expected to be using the site.
 */
import { parseArgs } from 'node:util';
import {
  type AckResult,
  type MatchedPayload,
  RESUME_PROTOCOL,
  type SessionEndedPayload,
  type SignalPayload,
} from '@bitsomeggle/shared';
import { io, type Socket } from 'socket.io-client';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3001' },
    clients: { type: 'string', default: '300' },
    seconds: { type: 'string', default: '60' },
    /** How many users connect per second at the start. */
    ramp: { type: 'string', default: '20' },
  },
});
const URL_ = args.url.replace(/\/$/, '');
const CLIENTS = Number(args.clients);
const SECONDS = Number(args.seconds);
const RAMP_PER_SECOND = Number(args.ramp);
if (![CLIENTS, SECONDS, RAMP_PER_SECOND].every((n) => Number.isInteger(n) && n > 0)) {
  throw new Error('--clients, --seconds and --ramp must be whole numbers above zero');
}

const ACK_TIMEOUT_MS = 10_000;
/** About the size of a real offer or answer. */
const FAKE_SDP = `v=0\r\n${'a=fake-line-of-session-description\r\n'.repeat(60)}`;
const CANDIDATES_PER_SIDE = 8;

const between = (min: number, max: number): number => min + Math.random() * (max - min);
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- measurements

const latencies: Record<string, number[]> = {
  connect: [],
  join: [],
  chat: [],
  next: [],
  health: [],
};
const counts = {
  connected: 0,
  connectFailed: 0,
  droppedByServer: 0,
  matches: 0,
  chatsDelivered: 0,
  signalsReceived: 0,
  refused: 0,
  noReply: 0,
  healthFailed: 0,
};
const refusalCodes = new Map<string, number>();
let stopping = false;

/** Sends a request, measures how long the server takes to answer, and records problems. */
async function timed(
  socket: Socket,
  kind: string,
  event: string,
  payload?: unknown,
): Promise<void> {
  const started = performance.now();
  try {
    const request = socket.timeout(ACK_TIMEOUT_MS);
    const reply = (await (payload === undefined
      ? request.emitWithAck(event)
      : request.emitWithAck(event, payload))) as AckResult;
    latencies[kind]?.push(performance.now() - started);
    // "not in a chat any more" is normal: the partner pressed Next a moment earlier.
    if (!reply.ok && reply.code !== 'not_in_session') {
      counts.refused += 1;
      refusalCodes.set(reply.code, (refusalCodes.get(reply.code) ?? 0) + 1);
    }
  } catch {
    if (!stopping) counts.noReply += 1;
  }
}

// ---------------------------------------------------------------- one pretend user

function startUser(): Socket {
  const connectStarted = performance.now();
  const socket = io(URL_, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: { protocol: RESUME_PROTOCOL },
  });
  /** The chat this user is in right now, if any. */
  let sessionId: string | null = null;

  const sendCandidates = (session: string): void => {
    for (let i = 0; i < CANDIDATES_PER_SIDE; i += 1) {
      socket.emit('signal', {
        sessionId: session,
        candidate: {
          candidate: `candidate:${i} 1 udp 2113937151 192.0.2.${i} 50000 typ host`,
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: 'fake',
        },
      });
    }
  };

  /** While in a chat: talk every few seconds, then press Next. */
  const haveConversation = async (session: string): Promise<void> => {
    const pressNextAt = performance.now() + between(10_000, 30_000);
    while (sessionId === session && !stopping) {
      await pause(between(3_000, 8_000));
      if (sessionId !== session || stopping) return;
      if (performance.now() >= pressNextAt) {
        sessionId = null;
        await timed(socket, 'next', 'session:next', { sessionId: session });
        return;
      }
      await timed(socket, 'chat', 'chat:send', {
        sessionId: session,
        text: 'hello from a load test',
      });
    }
  };

  socket.on('connect', () => {
    counts.connected += 1;
    latencies.connect?.push(performance.now() - connectStarted);
    void timed(socket, 'join', 'queue:join');
  });
  socket.on('connect_error', () => {
    counts.connectFailed += 1;
  });
  socket.on('disconnect', () => {
    if (!stopping) counts.droppedByServer += 1;
  });

  socket.on('session:matched', ({ sessionId: session, polite }: MatchedPayload) => {
    counts.matches += 1;
    sessionId = session;
    // Same rule as the real app: the impolite side makes the first offer.
    if (!polite) {
      socket.emit('signal', { sessionId: session, description: { type: 'offer', sdp: FAKE_SDP } });
      sendCandidates(session);
    }
    void haveConversation(session);
  });
  socket.on('signal', (payload: SignalPayload) => {
    counts.signalsReceived += 1;
    if (payload.sessionId !== sessionId) return;
    if ('description' in payload && payload.description.type === 'offer') {
      socket.emit('signal', {
        sessionId: payload.sessionId,
        description: { type: 'answer', sdp: FAKE_SDP },
      });
      sendCandidates(payload.sessionId);
    }
  });
  socket.on('chat:message', () => {
    counts.chatsDelivered += 1;
  });
  socket.on('session:ended', ({ sessionId: ended }: SessionEndedPayload) => {
    if (ended !== sessionId) return;
    sessionId = null;
    // Like a person reading "Stranger moved on" and then pressing Next.
    void pause(between(1_000, 3_000)).then(() => {
      if (!stopping && socket.connected) void timed(socket, 'join', 'queue:join');
    });
  });

  return socket;
}

// ---------------------------------------------------------------- the run

/** Asks /health now and then: how responsive the server looks to a newcomer. */
async function watchHealth(): Promise<void> {
  while (!stopping) {
    const started = performance.now();
    try {
      const response = await fetch(`${URL_}/health`, {
        signal: AbortSignal.timeout(ACK_TIMEOUT_MS),
      });
      if (response.ok) latencies.health?.push(performance.now() - started);
      else counts.healthFailed += 1;
    } catch {
      if (!stopping) counts.healthFailed += 1;
    }
    await pause(2_000);
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? Number.NaN;
}

function report(): void {
  const row = (name: string, values: number[]): Record<string, string | number> => {
    const sorted = [...values].sort((a, b) => a - b);
    const ms = (value: number): string => (Number.isNaN(value) ? '-' : `${Math.round(value)} ms`);
    return {
      request: name,
      count: sorted.length,
      median: ms(percentile(sorted, 50)),
      p95: ms(percentile(sorted, 95)),
      p99: ms(percentile(sorted, 99)),
      slowest: ms(sorted.at(-1) ?? Number.NaN),
    };
  };
  console.log('\nHow long the server took to answer:');
  console.table([
    row('connect', latencies.connect ?? []),
    row('join queue', latencies.join ?? []),
    row('chat message', latencies.chat ?? []),
    row('Next', latencies.next ?? []),
    row('GET /health', latencies.health ?? []),
  ]);
  console.log('What happened:');
  console.table({
    'users connected': `${counts.connected} of ${CLIENTS}`,
    'could not connect': counts.connectFailed,
    'disconnected by the server': counts.droppedByServer,
    'matches made (counted per user)': counts.matches,
    'chat messages delivered': counts.chatsDelivered,
    'call-setup messages delivered': counts.signalsReceived,
    'requests refused': counts.refused,
    'requests with no reply in 10 s': counts.noReply,
    'health checks failed': counts.healthFailed,
  });
  if (refusalCodes.size > 0) console.log('Refusals by reason:', Object.fromEntries(refusalCodes));
}

async function main(): Promise<void> {
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(URL_);
  console.log(`Load test: ${CLIENTS} users against ${URL_} for ${SECONDS} s`);
  if (!local) {
    console.log('This is not a local server. Real visitors online now will meet pretend users.');
  }

  void watchHealth();
  const sockets: Socket[] = [];
  for (let i = 0; i < CLIENTS; i += 1) {
    sockets.push(startUser());
    if ((i + 1) % RAMP_PER_SECOND === 0) await pause(1_000);
  }
  console.log(`All ${CLIENTS} users started. Running...`);

  const endAt = Date.now() + SECONDS * 1000;
  while (Date.now() < endAt) {
    await pause(Math.min(10_000, Math.max(0, endAt - Date.now())));
    const chat = [...(latencies.chat ?? [])].sort((a, b) => a - b);
    console.log(
      `  ${Math.max(0, Math.round((endAt - Date.now()) / 1000))} s left · connected ${counts.connected - counts.droppedByServer} · chat p95 so far ${Math.round(percentile(chat, 95)) || '-'} ms`,
    );
  }

  stopping = true;
  for (const socket of sockets) socket.disconnect();
  report();
}

await main();
process.exit(0);
