import type { IceServer } from '@bitsomeggle/shared';
import type { Logger } from 'pino';
import { z } from 'zod';
import { copyIceServers, type IceServerSource, STUN_SERVERS } from './iceServers.ts';

/**
 * How long each set of TURN credentials stays valid. Cloudflare cuts a relayed call when
 * its credentials expire, so this must be longer than the longest call we expect.
 */
export const CREDENTIAL_TTL_SECONDS = 12 * 60 * 60;
/**
 * How often we replace the credentials with fresh ones. Because we refresh every hour and
 * each set lasts 12 hours, any set we hand out still has at least 11 hours left.
 */
export const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
/** How soon we try again after a failed attempt. */
export const RETRY_INTERVAL_MS = 60 * 1000;
/** How long we wait for Cloudflare to answer before treating the attempt as failed. */
export const REQUEST_TIMEOUT_MS = 5000;

const API_BASE = 'https://rtc.live.cloudflare.com/v1/turn/keys';

/** The part of Cloudflare's answer we use. Checked before we trust it. */
const responseSchema = z.object({
  iceServers: z
    .array(
      z.object({
        urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
        username: z.string().optional(),
        credential: z.string().optional(),
      }),
    )
    .min(1)
    // An answer with no relay in it would be useless, so treat it as a failure.
    .refine((servers) => servers.some(hasTurnUrl), 'no TURN server in the answer'),
});

function hasTurnUrl(server: IceServer): boolean {
  const urls = typeof server.urls === 'string' ? [server.urls] : server.urls;
  return urls.some((url) => url.startsWith('turn:') || url.startsWith('turns:'));
}

export interface CloudflareTurnOptions {
  /** Identifies our TURN key at Cloudflare. Not secret by itself. */
  keyId: string;
  /** SECRET. Lets the holder create credentials billed to our account. Never log it. */
  apiToken: string;
  logger: Pick<Logger, 'info' | 'warn'>;
  now: () => number;
  /** Replaced in tests so no real request is made. */
  fetch?: typeof fetch;
}

/**
 * Keeps a current set of Cloudflare TURN credentials in memory.
 *
 * The idea: the long-lived secret (the API token) never leaves this server. With it we
 * ask Cloudflare for short-lived credentials, and those are what browsers receive. We
 * ask in the background, once an hour, and `getIceServers()` just reads the latest
 * answer from memory, which is instant.
 *
 * If Cloudflare cannot be reached we keep using the previous credentials while they are
 * still valid and retry every minute. With no valid credentials at all, browsers get
 * STUN only: calls still work wherever a direct path exists.
 *
 * LOGGING RULE: never log the API token or the credentials Cloudflare returns.
 */
export function createCloudflareTurnSource(options: CloudflareTurnOptions): IceServerSource {
  const { keyId, apiToken, logger, now } = options;
  const request = options.fetch ?? fetch;

  let current: { servers: IceServer[]; expiresAt: number } | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  async function refresh(): Promise<boolean> {
    const requestedAt = now();
    try {
      const response = await request(
        `${API_BASE}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        logger.warn({ httpStatus: response.status }, 'TURN credentials: Cloudflare refused');
        return false;
      }
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) {
        logger.warn('TURN credentials: unexpected answer from Cloudflare');
        return false;
      }
      current = {
        servers: parsed.data.iceServers,
        // Counted from before the request was sent, so we never overestimate.
        expiresAt: requestedAt + CREDENTIAL_TTL_SECONDS * 1000,
      };
      logger.info('TURN credentials refreshed');
      return true;
    } catch (error) {
      // Only the kind of error (for example "TimeoutError"), never its details.
      const kind = error instanceof Error ? error.name : 'unknown';
      logger.warn({ kind }, 'TURN credentials: could not reach Cloudflare');
      return false;
    }
  }

  async function refreshAndSchedule(): Promise<void> {
    const succeeded = await refresh();
    if (stopped) return;
    timer = setTimeout(
      () => void refreshAndSchedule(),
      succeeded ? REFRESH_INTERVAL_MS : RETRY_INTERVAL_MS,
    );
    // A pending refresh must not keep the server process alive during shutdown.
    timer.unref();
  }

  return {
    getIceServers: () =>
      copyIceServers(
        current !== null && now() < current.expiresAt ? current.servers : STUN_SERVERS,
      ),
    start: () => refreshAndSchedule(),
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
