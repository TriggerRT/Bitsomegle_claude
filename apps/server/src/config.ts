/**
 * Reads and validates configuration from environment variables once, at startup.
 * If something is wrong we throw immediately, so a bad deploy fails loudly
 * instead of misbehaving later.
 */

export interface ServerConfig {
  port: number;
}

const DEFAULT_PORT = 3001;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return { port: parsePort(env.PORT) };
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT "${raw}": expected an integer between 0 and 65535`);
  }
  return port;
}
