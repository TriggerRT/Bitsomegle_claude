import { describe, expect, it } from 'vitest';
import { getOpenStatus, parseOpenWindows } from '../../src/schedule/openHours.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The moment when clocks in India show the given time on 14 Nov 2026 (IST is UTC+5:30). */
function ist(hours: number, minutes = 0): number {
  return Date.UTC(2026, 10, 14, hours, minutes) - 5.5 * HOUR;
}

describe('parseOpenWindows', () => {
  it('treats a missing or empty value as "always open"', () => {
    expect(parseOpenWindows(undefined)).toEqual([]);
    expect(parseOpenWindows('')).toEqual([]);
    expect(parseOpenWindows('   ')).toEqual([]);
  });

  it('parses a single window', () => {
    expect(parseOpenWindows('21:00-23:30')).toEqual([
      { startMs: 21 * HOUR, durationMs: 2.5 * HOUR },
    ]);
  });

  it('parses a window that runs past midnight', () => {
    expect(parseOpenWindows('21:00-00:30')).toEqual([
      { startMs: 21 * HOUR, durationMs: 3.5 * HOUR },
    ]);
  });

  it('parses several windows and ignores spaces', () => {
    expect(parseOpenWindows(' 13:00-14:00 , 9:30-10:00 ')).toEqual([
      { startMs: 13 * HOUR, durationMs: HOUR },
      { startMs: 9.5 * HOUR, durationMs: 0.5 * HOUR },
    ]);
  });

  it.each([
    '21:00',
    '21:00-',
    '24:00-01:00',
    '21:60-22:00',
    '9pm-11pm',
    '21:00-22:00-23:00',
    '21:00-21:00',
    '21:00-22:00,',
  ])('rejects "%s" with a clear error', (raw) => {
    expect(() => parseOpenWindows(raw)).toThrow(/Invalid OPEN_WINDOWS/);
  });
});

describe('getOpenStatus', () => {
  it('is always open when no windows are configured', () => {
    expect(getOpenStatus([], ist(4))).toEqual({ open: true, opensAt: null, closesAt: null });
  });

  describe('with a 21:00 to 00:30 window', () => {
    const windows = parseOpenWindows('21:00-00:30');

    it('is closed in the afternoon and says when it opens', () => {
      expect(getOpenStatus(windows, ist(15))).toEqual({
        open: false,
        opensAt: ist(21),
        closesAt: null,
      });
    });

    it('is closed one millisecond before opening', () => {
      expect(getOpenStatus(windows, ist(21) - 1).open).toBe(false);
    });

    it('opens exactly at the start time and says when it closes', () => {
      expect(getOpenStatus(windows, ist(21))).toEqual({
        open: true,
        opensAt: null,
        closesAt: ist(24, 30),
      });
    });

    it('is still open after midnight', () => {
      expect(getOpenStatus(windows, ist(24, 10))).toEqual({
        open: true,
        opensAt: null,
        closesAt: ist(24, 30),
      });
    });

    it('closes exactly at the end time and points to the next evening', () => {
      expect(getOpenStatus(windows, ist(24, 30))).toEqual({
        open: false,
        opensAt: ist(21) + 24 * HOUR,
        closesAt: null,
      });
    });
  });

  describe('with two windows', () => {
    const windows = parseOpenWindows('13:00-14:00,21:00-23:00');

    it('reports the nearest opening time', () => {
      expect(getOpenStatus(windows, ist(10)).opensAt).toBe(ist(13));
      expect(getOpenStatus(windows, ist(15)).opensAt).toBe(ist(21));
      expect(getOpenStatus(windows, ist(23, 30)).opensAt).toBe(ist(13) + 24 * HOUR);
    });

    it('reports the end of the window it is in', () => {
      expect(getOpenStatus(windows, ist(13, 20)).closesAt).toBe(ist(14));
      expect(getOpenStatus(windows, ist(22)).closesAt).toBe(ist(23));
    });
  });

  it('uses the later end time when windows overlap', () => {
    const windows = parseOpenWindows('20:00-22:00,21:00-23:00');
    expect(getOpenStatus(windows, ist(21, 30)).closesAt).toBe(ist(23));
  });

  it('does not depend on the time zone of the machine', () => {
    // The calculation uses only the absolute time, so this holds wherever tests run.
    const windows = parseOpenWindows('00:00-01:00');
    const midnightIst = Date.UTC(2026, 10, 13, 18, 30); // 18:30 UTC = 00:00 IST next day
    expect(getOpenStatus(windows, midnightIst).open).toBe(true);
    expect(getOpenStatus(windows, midnightIst - MINUTE).open).toBe(false);
  });
});
