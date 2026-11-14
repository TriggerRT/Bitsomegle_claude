/**
 * Helpers for integration tests: a real server on a private port, and pretend browsers
 * ("test clients") that connect to it over real WebSockets using the same Socket.IO
 * client library the web app will use.
 */
import type { AddressInfo } from 'node:net';
import type {
  AckResult,
  MatchedPayload,
  SessionEndedPayload,
  StatusPayload,
} from '@bitsomeggle/shared';
import { io, type Socket } from 'socket.io-client';
import { type App, type AppOverrides, createApp } from '../../src/app.ts';
import type { ServerConfig } from '../../src/config.ts';
import type { ClientView } from '../../src/matchmaking/types.ts';
import { DEFAULT_RATE_LIMITS, type RateLimits } from '../../src/socket/rateLimit.ts';

const TIMEOUT_MS = 3000;

/** Limits so high that ordinary tests never hit them. Rate-limit tests pass their own. */
export const GENEROUS_RATE_LIMITS: RateLimits = {
  join: { burst: 10_000, perSecond: 10_000 },
  next: { burst: 10_000, perSecond: 10_000 },
  leave: { burst: 10_000, perSecond: 10_000 },
  chat: { burst: 10_000, perSecond: 10_000 },
  signal: { burst: 10_000, perSecond: 10_000 },
  media: { burst: 10_000, perSecond: 10_000 },
  strike: DEFAULT_RATE_LIMITS.strike,
};

interface ReceivedEvent {
  event: string;
  payload: unknown;
}

/** One pretend browser. Records every event the server sends it. */
export class TestClient {
  readonly socket: Socket;
  /** Everything received, in order. */
  readonly log: ReceivedEvent[] = [];
  private readonly unread = new Map<string, unknown[]>();
  private readonly waiters = new Map<string, Array<(payload: unknown) => void>>();

  constructor(url: string) {
    this.socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    this.socket.onAny((event: string, payload: unknown) => {
      this.log.push({ event, payload });
      const waiter = this.waiters.get(event)?.shift();
      if (waiter) waiter(payload);
      else this.unread.set(event, [...(this.unread.get(event) ?? []), payload]);
    });
  }

  get id(): string {
    if (!this.socket.id) throw new Error('test client is not connected');
    return this.socket.id;
  }

  /** Resolves once connected, or rejects with the server's refusal message. */
  waitUntilConnected(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket.connected) return resolve();
      this.socket.once('connect', () => resolve());
      this.socket.once('connect_error', (error) => reject(error));
    });
  }

  waitUntilDisconnected(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.socket.disconnected) return resolve('already disconnected');
      const timer = setTimeout(() => reject(new Error('client was not disconnected')), TIMEOUT_MS);
      this.socket.once('disconnect', (reason) => {
        clearTimeout(timer);
        resolve(reason);
      });
    });
  }

  /** The next not-yet-read event with this name. Waits for it if it has not arrived. */
  next<T = unknown>(event: string): Promise<T> {
    const queued = this.unread.get(event);
    if (queued && queued.length > 0) return Promise.resolve(queued.shift() as T);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for "${event}"`)),
        TIMEOUT_MS,
      );
      const waiter = (payload: unknown): void => {
        clearTimeout(timer);
        resolve(payload as T);
      };
      this.waiters.set(event, [...(this.waiters.get(event) ?? []), waiter]);
    });
  }

  /** Events with this name that arrived and have not been read by `next`. */
  unreadCount(event: string): number {
    return this.unread.get(event)?.length ?? 0;
  }

  /** Sends an event and waits for the server's reply (ack). */
  request(event: string, ...args: unknown[]): Promise<AckResult> {
    return this.socket.timeout(TIMEOUT_MS).emitWithAck(event, ...args) as Promise<AckResult>;
  }

  /** Sends an event without asking for a reply. */
  send(event: string, ...args: unknown[]): void {
    this.socket.emit(event, ...args);
  }

  /**
   * Waits until this client has received everything the server sent it so far.
   *
   * How: messages on one connection arrive in the order they were sent. So we make a
   * harmless request and wait for its reply; anything the server sent us earlier must
   * have arrived before that reply. This lets tests assert "nothing arrived" without
   * guessing how long to wait.
   */
  async sync(): Promise<void> {
    await this.request('chat:send', { sessionId: 'sync-barrier', text: 'sync' });
  }

  /**
   * What this browser would believe its state is, worked out ONLY from the events it
   * received. Compared against the server's own state in tests.
   */
  viewFromEvents(): ClientView {
    const view: ClientView = { state: 'idle', sessionId: null };
    for (const { event, payload } of this.log) {
      if (event === 'queue:waiting') {
        view.state = 'waiting';
        view.sessionId = null;
      } else if (event === 'session:matched') {
        view.state = 'in_session';
        view.sessionId = (payload as MatchedPayload).sessionId;
      } else if (event === 'session:ended') {
        if ((payload as SessionEndedPayload).sessionId === view.sessionId) {
          view.state = 'idle';
          view.sessionId = null;
        }
      }
    }
    return view;
  }

  close(): void {
    this.socket.disconnect();
  }
}

export interface TestServer {
  app: App;
  url: string;
  /** Connects a new pretend browser and waits for its first `status` event. */
  connect: () => Promise<TestClient & { status: StatusPayload }>;
  /** Connects without waiting, for tests where the connection is expected to fail. */
  connectRaw: () => TestClient;
  stop: () => Promise<void>;
}

export async function startTestServer(
  config: Partial<ServerConfig> = {},
  overrides: AppOverrides = {},
): Promise<TestServer> {
  const app = createApp(
    {
      port: 0,
      corsOrigins: ['http://localhost:5173'],
      openWindows: [],
      maxClients: 1000,
      logLevel: 'silent',
      ...config,
    },
    { rateLimits: GENEROUS_RATE_LIMITS, ...overrides },
  );

  // Port 0 asks the operating system for any free port.
  await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
  const { port } = app.httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  const clients: TestClient[] = [];

  const connectRaw = (): TestClient => {
    const client = new TestClient(url);
    clients.push(client);
    return client;
  };

  return {
    app,
    url,
    connectRaw,
    connect: async () => {
      const client = connectRaw();
      await client.waitUntilConnected();
      const status = await client.next<StatusPayload>('status');
      return Object.assign(client, { status });
    },
    stop: async () => {
      for (const client of clients) client.close();
      await app.close();
    },
  };
}

/** Puts two clients in a session together and returns its id. */
export async function pair(a: TestClient, b: TestClient): Promise<string> {
  await a.request('queue:join');
  await a.next('queue:waiting');
  await b.request('queue:join');
  const [forA, forB] = await Promise.all([
    a.next<MatchedPayload>('session:matched'),
    b.next<MatchedPayload>('session:matched'),
  ]);
  if (forA.sessionId !== forB.sessionId)
    throw new Error('pair(): clients are in different sessions');
  return forA.sessionId;
}
