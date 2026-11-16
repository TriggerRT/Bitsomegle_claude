import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Logger } from 'pino';

export const STATS_INTERVAL_MS = 60_000;
const RESOLUTION_MS = 20;

export interface StatsLogOptions {
  /** Current numbers from the matchmaker. */
  getCounts: () => { clients: number; waiting: number; sessions: number };
  logger: Pick<Logger, 'info'>;
  intervalMs?: number;
}

/**
 * Writes one log line a minute with how busy the server is, while anyone is connected.
 * It answers two questions after the fact: "how many people were online tonight?" and
 * "was the server keeping up?".
 *
 * `loopDelayP99Ms` is the important one for the second question. Node handles one thing
 * at a time (docs/ARCHITECTURE.md §2.2); when it is overloaded, things wait in line. This
 * number says how long the line was: 99% of the time, work started within that many
 * milliseconds of when it should have. Under about 50 nobody notices. In the hundreds,
 * buttons and call setup feel slow.
 *
 * Only counts are logged: no ids, no addresses, no content.
 *
 * Returns a function that stops it.
 */
export function startStatsLog(options: StatsLogOptions): () => void {
  const { getCounts, logger } = options;
  const loopDelay = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  loopDelay.enable();

  // The monitor works by setting a timer every RESOLUTION_MS and noting when it really
  // fires, so an idle server reads about RESOLUTION_MS. Subtracting it leaves the lateness.
  const toMs = (nanoseconds: number): number =>
    Math.max(0, Math.round(nanoseconds / 1e6) - RESOLUTION_MS);

  const timer = setInterval(() => {
    const counts = getCounts();
    if (counts.clients > 0) {
      logger.info(
        {
          ...counts,
          loopDelayP99Ms: toMs(loopDelay.percentile(99)),
          loopDelayMaxMs: toMs(loopDelay.max),
          memoryMb: Math.round(process.memoryUsage.rss() / 1024 / 1024),
        },
        'stats',
      );
    }
    // Start measuring afresh, so each line describes its own minute.
    loopDelay.reset();
  }, options.intervalMs ?? STATS_INTERVAL_MS);
  timer.unref();

  return () => {
    clearInterval(timer);
    loopDelay.disable();
  };
}
