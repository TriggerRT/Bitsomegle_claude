/**
 * Opening hours. Bitsomeggle only makes new matches during set windows each day, so that
 * everyone is online at the same time (docs/DECISIONS.md D-011).
 *
 * Windows are written in Indian Standard Time, which is always UTC+5:30 (India has no
 * daylight saving time), so the conversion is simple arithmetic and does not depend on the
 * time zone of whatever machine the server runs on.
 *
 * Everything here is a pure function of "what time is it now", which makes it easy to test.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const IST_OFFSET_MS = 330 * MINUTE_MS;

export interface OpenWindow {
  /** Start of the window, in milliseconds after midnight IST. */
  readonly startMs: number;
  /** Length of the window in milliseconds. A window may run past midnight. */
  readonly durationMs: number;
}

export interface OpenStatus {
  open: boolean;
  /** When the site next opens (ms since 1970). Null if open now, or if always open. */
  opensAt: number | null;
  /** When the current window ends (ms since 1970). Null if closed, or if always open. */
  closesAt: number | null;
}

/** `%` in JavaScript can return negative numbers; this version always returns 0 to DAY_MS. */
function wrapDay(ms: number): number {
  return ((ms % DAY_MS) + DAY_MS) % DAY_MS;
}

function parseClockTime(text: string, whole: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  if (!match || hours > 23 || minutes > 59) {
    throw new Error(`Invalid OPEN_WINDOWS entry "${whole}": expected HH:MM-HH:MM in 24-hour time`);
  }
  return (hours * 60 + minutes) * MINUTE_MS;
}

/**
 * Parses the OPEN_WINDOWS setting, for example "21:00-00:30" or "13:00-14:00,21:00-00:30".
 * An end time earlier than the start time means the window runs past midnight.
 * An empty or missing value means "always open" (the default for local development).
 */
export function parseOpenWindows(raw: string | undefined): OpenWindow[] {
  if (raw === undefined || raw.trim() === '') return [];

  return raw.split(',').map((entry) => {
    const parts = entry.split('-');
    if (parts.length !== 2) {
      throw new Error(`Invalid OPEN_WINDOWS entry "${entry}": expected HH:MM-HH:MM`);
    }
    const startMs = parseClockTime(parts[0] ?? '', entry);
    const endMs = parseClockTime(parts[1] ?? '', entry);
    if (startMs === endMs) {
      throw new Error(`Invalid OPEN_WINDOWS entry "${entry}": start and end are the same`);
    }
    return { startMs, durationMs: wrapDay(endMs - startMs) };
  });
}

/** Works out whether the site is open at `nowMs`, and when that next changes. */
export function getOpenStatus(windows: readonly OpenWindow[], nowMs: number): OpenStatus {
  if (windows.length === 0) return { open: true, opensAt: null, closesAt: null };

  const timeOfDayMs = wrapDay(nowMs + IST_OFFSET_MS);
  let closesAt: number | null = null;
  let opensAt = Number.POSITIVE_INFINITY;

  for (const window of windows) {
    const sinceStartMs = wrapDay(timeOfDayMs - window.startMs);
    if (sinceStartMs < window.durationMs) {
      // Inside this window. If windows overlap, the latest ending one counts.
      closesAt = Math.max(closesAt ?? 0, nowMs + window.durationMs - sinceStartMs);
    } else {
      opensAt = Math.min(opensAt, nowMs + DAY_MS - sinceStartMs);
    }
  }

  if (closesAt !== null) return { open: true, opensAt: null, closesAt };
  return { open: false, opensAt, closesAt: null };
}
