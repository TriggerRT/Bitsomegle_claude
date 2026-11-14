/**
 * Reads and validates configuration from environment variables once, at startup.
 * If something is wrong we throw immediately, so a bad deploy fails loudly
 * instead of misbehaving later.
 */
import { type OpenWindow, parseOpenWindows } from './schedule/openHours.ts';

const LOG_LEVELS = ['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface ServerConfig {
  port: number;
  /** Websites whose pages may connect to this server from a browser. */
  corsOrigins: string[];
  /** Daily opening windows in IST. Empty means always open. */
  openWindows: OpenWindow[];
  /** Soft cap on simultaneous connections. */
  maxClients: number;
  /** Cap on simultaneous connections from one IP address. 0 means no cap. */
  maxClientsPerIp: number;
  /**
   * Name of the request header in which the hosting proxy reports the visitor's real IP
   * address. null means there is no proxy: use the address of the connection itself.
   */
  clientIpHeader: string | null;
  /** Cloudflare TURN key for relayed calls. null means STUN only (no relay). */
  turn: TurnConfig | null;
  logLevel: LogLevel;
}

export interface TurnConfig {
  keyId: string;
  /** SECRET. Never log it and never send it to a browser. */
  apiToken: string;
}

const DEFAULT_PORT = 3001;
const DEFAULT_MAX_CLIENTS = 1000;
/** Where the Vite dev server runs. Only used when CORS_ORIGIN is not set, outside production. */
const DEV_CORS_ORIGIN = 'http://localhost:5173';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: parseInteger('PORT', env.PORT, DEFAULT_PORT, 0, 65535),
    corsOrigins: parseCorsOrigins(env.CORS_ORIGIN, env.NODE_ENV === 'production'),
    openWindows: parseOpenWindows(env.OPEN_WINDOWS),
    maxClients: parseInteger('MAX_CLIENTS', env.MAX_CLIENTS, DEFAULT_MAX_CLIENTS, 1, 100_000),
    maxClientsPerIp: parseInteger('MAX_CLIENTS_PER_IP', env.MAX_CLIENTS_PER_IP, 0, 0, 100_000),
    clientIpHeader: parseHeaderName(env.CLIENT_IP_HEADER),
    turn: parseTurn(env.TURN_KEY_ID, env.TURN_KEY_API_TOKEN),
    logLevel: parseLogLevel(env.LOG_LEVEL),
  };
}

function isBlank(raw: string | undefined): raw is undefined {
  return raw === undefined || raw.trim() === '';
}

function parseInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (isBlank(raw)) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${name} "${raw}": expected an integer between ${min} and ${max}`);
  }
  return value;
}

function parseCorsOrigins(raw: string | undefined, isProduction: boolean): string[] {
  if (isBlank(raw)) {
    if (isProduction) {
      throw new Error('CORS_ORIGIN must be set in production (the address of the web app)');
    }
    return [DEV_CORS_ORIGIN];
  }

  return raw.split(',').map((entry) => {
    const origin = entry.trim();
    // An origin is scheme + host (+ port) with no path, e.g. https://bitsomeggle.vercel.app
    if (!URL.canParse(origin) || new URL(origin).origin !== origin) {
      throw new Error(
        `Invalid CORS_ORIGIN entry "${origin}": expected something like https://example.com`,
      );
    }
    return origin;
  });
}

function parseHeaderName(raw: string | undefined): string | null {
  if (isBlank(raw)) return null;
  // Node gives us header names in lower case, so we store the name that way too.
  const name = raw.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(
      `Invalid CLIENT_IP_HEADER "${raw}": expected a header name like true-client-ip`,
    );
  }
  return name;
}

function parseTurn(keyId: string | undefined, apiToken: string | undefined): TurnConfig | null {
  if (isBlank(keyId) && isBlank(apiToken)) return null;
  if (isBlank(keyId) || isBlank(apiToken)) {
    // One without the other is a mistake. Say so now instead of silently having no relay.
    throw new Error('TURN_KEY_ID and TURN_KEY_API_TOKEN must be set together (or both left empty)');
  }
  return { keyId: keyId.trim(), apiToken: apiToken.trim() };
}

function parseLogLevel(raw: string | undefined): LogLevel {
  if (isBlank(raw)) return 'info';
  const level = raw.trim();
  if (!LOG_LEVELS.includes(level as LogLevel)) {
    throw new Error(`Invalid LOG_LEVEL "${raw}": expected one of ${LOG_LEVELS.join(', ')}`);
  }
  return level as LogLevel;
}
