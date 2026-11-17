import { describe, expect, it, vi } from 'vitest';
import { createLogModerationSink } from '../../src/moderation/ModerationSink.ts';
import { DEFAULT_REPORT_RULES, ReportTracker } from '../../src/moderation/ReportTracker.ts';

const MINUTE = 60_000;
const rules = { threshold: 3, windowMs: 15 * MINUTE, cooldownMs: 10 * MINUTE };

describe('ReportTracker', () => {
  it('uses sensible rules by default', () => {
    expect(DEFAULT_REPORT_RULES).toEqual(rules);
  });

  it('does nothing visible for one or two reports', () => {
    const tracker = new ReportTracker(rules);
    expect(tracker.record('r1', 'x', 0)).toEqual({ isNew: true, cooldownStartedUntil: null });
    expect(tracker.record('r2', 'x', 1000)).toEqual({ isNew: true, cooldownStartedUntil: null });
    expect(tracker.cooldownUntil('x', 2000)).toBeNull();
  });

  it('starts a cooldown when the third different person reports', () => {
    const tracker = new ReportTracker(rules);
    tracker.record('r1', 'x', 0);
    tracker.record('r2', 'x', 1000);

    expect(tracker.record('r3', 'x', 2000)).toEqual({
      isNew: true,
      cooldownStartedUntil: 2000 + 10 * MINUTE,
    });
    expect(tracker.cooldownUntil('x', 3000)).toBe(2000 + 10 * MINUTE);
  });

  it('one person reporting again and again counts once', () => {
    const tracker = new ReportTracker(rules);
    expect(tracker.record('r1', 'x', 0).isNew).toBe(true);
    for (let i = 1; i <= 10; i += 1) {
      expect(tracker.record('r1', 'x', i * 1000)).toEqual({
        isNew: false,
        cooldownStartedUntil: null,
      });
    }
    expect(tracker.cooldownUntil('x', 20_000)).toBeNull();
  });

  it('reports about different people are counted separately', () => {
    const tracker = new ReportTracker(rules);
    tracker.record('r1', 'x', 0);
    tracker.record('r2', 'x', 0);
    tracker.record('r3', 'y', 0);
    expect(tracker.cooldownUntil('x', 1)).toBeNull();
    expect(tracker.cooldownUntil('y', 1)).toBeNull();
  });

  it('old reports stop counting after the window', () => {
    const tracker = new ReportTracker(rules);
    tracker.record('r1', 'x', 0);
    tracker.record('r2', 'x', 1000);

    // r1's report is exactly 15 minutes old now, so only r2 and r3 count.
    expect(tracker.record('r3', 'x', 15 * MINUTE).cooldownStartedUntil).toBeNull();
    // A fourth person within the window of r2 and r3 makes three again.
    expect(tracker.record('r4', 'x', 15 * MINUTE + 500).cooldownStartedUntil).not.toBeNull();
  });

  it('the cooldown ends by itself', () => {
    const tracker = new ReportTracker(rules);
    for (const reporter of ['r1', 'r2', 'r3']) tracker.record(reporter, 'x', 0);

    expect(tracker.cooldownUntil('x', 10 * MINUTE - 1)).toBe(10 * MINUTE);
    expect(tracker.cooldownUntil('x', 10 * MINUTE)).toBeNull();
  });

  it('reports during a cooldown do not restart or extend it', () => {
    const tracker = new ReportTracker(rules);
    for (const reporter of ['r1', 'r2', 'r3']) tracker.record(reporter, 'x', 0);

    for (const reporter of ['r4', 'r5', 'r6']) {
      expect(tracker.record(reporter, 'x', MINUTE).cooldownStartedUntil).toBeNull();
    }
    expect(tracker.cooldownUntil('x', 2 * MINUTE)).toBe(10 * MINUTE);
  });

  it('after a cooldown it takes three new reports to start another', () => {
    const tracker = new ReportTracker(rules);
    for (const reporter of ['r1', 'r2', 'r3']) tracker.record(reporter, 'x', 0);
    const later = 11 * MINUTE;

    expect(tracker.record('r1', 'x', later).cooldownStartedUntil).toBeNull();
    expect(tracker.record('r2', 'x', later).cooldownStartedUntil).toBeNull();
    expect(tracker.record('r3', 'x', later).cooldownStartedUntil).toBe(later + 10 * MINUTE);
  });

  it('forgets a connection that has gone, so nothing piles up', () => {
    const tracker = new ReportTracker(rules);
    for (const reporter of ['r1', 'r2', 'r3']) tracker.record(reporter, 'x', 0);
    tracker.record('r1', 'y', 0);
    expect(tracker.size).toBeGreaterThan(0);

    tracker.forget('x');
    tracker.forget('y');

    expect(tracker.size).toBe(0);
    expect(tracker.cooldownUntil('x', 1)).toBeNull();
  });
});

describe('log moderation sink', () => {
  it('writes reports and cooldowns as structured log lines with ids and a reason only', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const sink = createLogModerationSink(logger);

    sink.report({ reporter: 'r1', reported: 'x', sessionId: 's1', reason: 'harassment' });
    sink.cooldown({ client: 'x', until: 123 });

    expect(logger.info).toHaveBeenCalledWith(
      { reporter: 'r1', reported: 'x', sessionId: 's1', reason: 'harassment' },
      'moderation: report',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { client: 'x', until: 123 },
      'moderation: cooldown started',
    );
  });
});
