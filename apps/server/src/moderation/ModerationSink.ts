import type { ReportReason } from '@bitsomeggle/shared';
import type { Logger } from 'pino';

/**
 * Where moderation events go. Today they are written to the server log; later this
 * could be a database or an alert, without touching the code that produces the events.
 *
 * PRIVACY: events carry random connection ids and a reason picked from a fixed list.
 * Never chat text, never an IP address. The ids mean nothing once those connections
 * have closed, so the log shows how much is being reported, not who anyone is.
 */
export interface ModerationSink {
  /** One person reported another. Called once per reporter and reported person. */
  report(event: {
    reporter: string;
    reported: string;
    sessionId: string;
    reason: ReportReason;
  }): void;
  /** Someone was blocked from matching until `until` after several reports. */
  cooldown(event: { client: string; until: number }): void;
}

export function createLogModerationSink(logger: Pick<Logger, 'info' | 'warn'>): ModerationSink {
  return {
    report: (event) => logger.info(event, 'moderation: report'),
    cooldown: (event) => logger.warn(event, 'moderation: cooldown started'),
  };
}
