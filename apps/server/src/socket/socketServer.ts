import type { Server as HttpServer } from 'node:http';
import {
  type AckResult,
  chatSendSchema,
  type ErrorCode,
  type IceServer,
  mediaStateSchema,
  nextSchema,
  type ServerToClientEvents,
  type StatusPayload,
  signalSchema,
} from '@bitsomeggle/shared';
import type { Logger } from 'pino';
import { type DefaultEventsMap, Server, type Socket } from 'socket.io';
import type { ZodType } from 'zod';
import type { Matchmaker } from '../matchmaking/Matchmaker.ts';
import type { MatchEffect } from '../matchmaking/types.ts';
import type { OpenStatus } from '../schedule/openHours.ts';
import { ConnectionCounter, clientIpOf, KNOWN_IP_HEADERS } from './ipLimit.ts';
import { RateLimiter, type RateLimits } from './rateLimit.ts';

/**
 * Events we SEND are fully typed. Events we RECEIVE are deliberately left untyped
 * (`DefaultEventsMap`): anything can arrive from a browser, so every handler below starts
 * from `unknown` and validates before using the data.
 */
export type SocketServer = Server<DefaultEventsMap, ServerToClientEvents>;
type ClientSocket = Socket<DefaultEventsMap, ServerToClientEvents>;

/** Largest single message accepted from a browser. Bigger ones close that connection. */
export const MAX_MESSAGE_BYTES = 32 * 1024;

/**
 * How often the server checks each connection is alive, and how long it waits for the
 * reply. A browser that vanishes without saying goodbye (laptop lid closed, Wi-Fi lost)
 * is removed from matchmaking within about 20 seconds.
 */
const PING_INTERVAL_MS = 10_000;
const PING_TIMEOUT_MS = 10_000;

export interface SocketServerOptions {
  matchmaker: Matchmaker;
  /** Whether the site is open at the given time (see schedule/openHours.ts). */
  getOpenStatus: (nowMs: number) => OpenStatus;
  /** Websites allowed to connect from a browser (CORS allow-list). */
  corsOrigins: readonly string[];
  /** Soft cap on simultaneous connections, to protect a small server. */
  maxClients: number;
  /** Cap on simultaneous connections from one IP address. 0 means no cap. */
  maxClientsPerIp: number;
  /** Header in which the hosting proxy reports the visitor's IP. null: no proxy. */
  clientIpHeader: string | null;
  rateLimits: RateLimits;
  /** STUN/TURN servers handed to both browsers when they are matched. */
  getIceServers: () => IceServer[];
  logger: Logger;
  now: () => number;
}

/**
 * Attaches Socket.IO to the HTTP server and translates between socket events and the
 * Matchmaker. This file is the only place where the two meet:
 *
 *   browser event -> rate limit -> validate -> Matchmaker call -> deliver returned effects
 *
 * No matchmaking decisions are made here, and nothing in a handler is `async`, so each
 * event is fully processed before the next one starts.
 */
export function attachSocketServer(
  httpServer: HttpServer,
  options: SocketServerOptions,
): SocketServer {
  const { matchmaker, getOpenStatus, logger, now } = options;

  const io: SocketServer = new Server(httpServer, {
    cors: { origin: [...options.corsOrigins] },
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    pingInterval: PING_INTERVAL_MS,
    pingTimeout: PING_TIMEOUT_MS,
  });

  const currentStatus = (): StatusPayload => ({
    ...getOpenStatus(now()),
    online: matchmaker.stats().clients,
  });

  /** Sends each effect to the one client it is addressed to. */
  const deliver = (effects: MatchEffect[]): void => {
    for (const effect of effects) {
      // Every socket automatically sits in a private "room" named after its own id.
      const target = io.to(effect.to);
      if (effect.type === 'waiting') {
        target.emit('queue:waiting');
      } else if (effect.type === 'matched') {
        target.emit('session:matched', {
          sessionId: effect.sessionId,
          polite: effect.polite,
          iceServers: options.getIceServers(),
        });
        logger.debug({ sessionId: effect.sessionId, client: effect.to }, 'session matched');
      } else {
        target.emit('session:ended', { sessionId: effect.sessionId, reason: effect.reason });
        logger.debug({ sessionId: effect.sessionId, reason: effect.reason }, 'session ended');
      }
    }
  };

  // Per-IP cap (see ipLimit.ts). Addresses are counted only when the cap is switched on.
  const perIpCap = options.maxClientsPerIp;
  const connectionsPerIp = new ConnectionCounter();
  const ipOf = (socket: ClientSocket): string | null =>
    perIpCap > 0 ? clientIpOf(socket.handshake, options.clientIpHeader) : null;
  let firstConnectionSeen = false;
  let warnedAboutMissingIp = false;

  // Runs before a connection is accepted.
  io.use((socket, next) => {
    if (io.of('/').sockets.size >= options.maxClients) {
      logger.warn({ maxClients: options.maxClients }, 'connection refused: server full');
      next(new Error('server_full'));
      return;
    }
    const ip = ipOf(socket);
    if (ip !== null && connectionsPerIp.count(ip) >= perIpCap) {
      // The address itself is deliberately not logged.
      logger.warn({ perIpCap }, 'connection refused: too many connections from one address');
      next(new Error('server_full'));
      return;
    }
    next();
  });

  io.on('connection', (socket) => {
    const clientId = socket.id;
    const limiter = new RateLimiter(options.rateLimits, now);

    if (!firstConnectionSeen) {
      firstConnectionSeen = true;
      // Helps check, after deploying, which header the host uses for the visitor's
      // address. Header NAMES only, never their values.
      const present = KNOWN_IP_HEADERS.filter((name) => socket.handshake.headers[name]);
      logger.info({ present }, 'address headers on the first connection (names only)');
    }

    const ip = ipOf(socket);
    if (ip !== null) connectionsPerIp.add(ip);
    else if (perIpCap > 0 && !warnedAboutMissingIp) {
      warnedAboutMissingIp = true;
      logger.warn(
        { header: options.clientIpHeader },
        'per-IP cap: visitor address not found, connection not counted (check CLIENT_IP_HEADER)',
      );
    }

    matchmaker.connect(clientId);
    logger.debug({ client: clientId }, 'client connected');
    socket.emit('status', currentStatus());

    registerHandlers(socket, limiter);

    socket.on('disconnect', (reason) => {
      if (ip !== null) connectionsPerIp.remove(ip);
      deliver(matchmaker.disconnect(clientId));
      logger.debug({ client: clientId, reason }, 'client disconnected');
    });
  });

  function registerHandlers(socket: ClientSocket, limiter: RateLimiter): void {
    const clientId = socket.id;

    /**
     * Registers one event. Before `handler` runs, the request must pass the rate limit and
     * (if the event has a payload) match its schema. The handler's return value is the reply.
     */
    function on<T>(
      event: string,
      limit: keyof RateLimits,
      schema: ZodType<T> | null,
      handler: (payload: T) => AckResult,
    ): void {
      socket.on(event, (...args: unknown[]) => {
        // A well-behaved client passes a reply callback as the last argument.
        const last = args.at(-1);
        const ack = typeof last === 'function' ? (last as (result: AckResult) => void) : null;

        const respond = (result: AckResult): void => {
          if (ack) ack(result);
          // Without a callback, tell the client about real problems. A message for a
          // session that has just ended is normal (it was already on its way), so that
          // case stays silent.
          else if (!result.ok && result.code !== 'not_in_session') {
            socket.emit('server:error', { code: result.code });
          }
        };

        const refuse = (code: ErrorCode): void => {
          if (!limiter.allow('strike')) {
            logger.warn({ client: clientId, event }, 'disconnecting client: too many bad requests');
            socket.disconnect(true);
            return;
          }
          respond({ ok: false, code });
        };

        if (!limiter.allow(limit)) {
          refuse('rate_limited');
          return;
        }

        let payload = undefined as T;
        if (schema) {
          const parsed = schema.safeParse(args[0]);
          if (!parsed.success) {
            refuse('invalid');
            return;
          }
          payload = parsed.data;
        }

        respond(handler(payload));
      });
    }

    const isOpen = (): boolean => getOpenStatus(now()).open;
    const ok: AckResult = { ok: true };
    const notInSession: AckResult = { ok: false, code: 'not_in_session' };
    const closed: AckResult = { ok: false, code: 'closed' };

    on('queue:join', 'join', null, () => {
      if (!isOpen()) return closed;
      deliver(matchmaker.join(clientId));
      return ok;
    });

    on('session:next', 'next', nextSchema, ({ sessionId }) => {
      if (!isOpen()) {
        // Outside opening hours nobody new can be found. Still end the call the user
        // asked to end, then tell them the site is closed.
        if (matchmaker.getPartner(clientId, sessionId) !== null) {
          deliver(matchmaker.leave(clientId));
        }
        return closed;
      }
      deliver(matchmaker.next(clientId, sessionId));
      return ok;
    });

    on('leave', 'leave', null, () => {
      deliver(matchmaker.leave(clientId));
      return ok;
    });

    // The three relay events below share one rule: a message is passed on only if it names
    // the sender's CURRENT session. `getPartner` enforces that, so nothing can leak into
    // another conversation, and nobody can address a session they are not part of.

    on('chat:send', 'chat', chatSendSchema, ({ sessionId, text }) => {
      const partnerId = matchmaker.getPartner(clientId, sessionId);
      if (partnerId === null) return notInSession;
      io.to(partnerId).emit('chat:message', { sessionId, text, at: now() });
      return ok;
    });

    on('signal', 'signal', signalSchema, (payload) => {
      const partnerId = matchmaker.getPartner(clientId, payload.sessionId);
      if (partnerId === null) return notInSession;
      io.to(partnerId).emit('signal', payload);
      return ok;
    });

    on('media:state', 'media', mediaStateSchema, (payload) => {
      const partnerId = matchmaker.getPartner(clientId, payload.sessionId);
      if (partnerId === null) return notInSession;
      io.to(partnerId).emit('media:state', payload);
      return ok;
    });
  }

  return io;
}
