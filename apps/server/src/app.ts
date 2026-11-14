import type { Server as HttpServer } from 'node:http';
import { type Logger, pino } from 'pino';
import type { ServerConfig } from './config.ts';
import { createHttpServer } from './http.ts';
import { Matchmaker } from './matchmaking/Matchmaker.ts';
import { getOpenStatus } from './schedule/openHours.ts';
import { DEFAULT_RATE_LIMITS, type RateLimits } from './socket/rateLimit.ts';
import { attachSocketServer, type SocketServer } from './socket/socketServer.ts';

export interface App {
  httpServer: HttpServer;
  io: SocketServer;
  matchmaker: Matchmaker;
  logger: Logger;
  /** Disconnects everyone and stops the HTTP server. */
  close: () => Promise<void>;
}

/** Things tests replace to make behaviour predictable. Production uses the defaults. */
export interface AppOverrides {
  now?: () => number;
  rateLimits?: RateLimits;
}

/**
 * Builds the whole server (HTTP + Socket.IO + matchmaking) without starting to listen.
 * `index.ts` calls this for the real server; tests call it to get a private instance.
 *
 * LOGGING RULE: log event names and random ids only. Never log chat text, call-setup
 * messages (SDP / ICE candidates) or IP addresses.
 */
export function createApp(config: ServerConfig, overrides: AppOverrides = {}): App {
  const logger = pino({ level: config.logLevel });
  const matchmaker = new Matchmaker();
  const httpServer = createHttpServer();

  const io = attachSocketServer(httpServer, {
    matchmaker,
    getOpenStatus: (nowMs) => getOpenStatus(config.openWindows, nowMs),
    corsOrigins: config.corsOrigins,
    maxClients: config.maxClients,
    rateLimits: overrides.rateLimits ?? DEFAULT_RATE_LIMITS,
    logger,
    now: overrides.now ?? Date.now,
  });

  return {
    httpServer,
    io,
    matchmaker,
    logger,
    // Closing Socket.IO also closes the HTTP server it is attached to.
    close: () => io.close(),
  };
}
