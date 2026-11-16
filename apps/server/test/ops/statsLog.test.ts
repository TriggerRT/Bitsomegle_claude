import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATS_INTERVAL_MS, startStatsLog } from '../../src/ops/statsLog.ts';

describe('stats log', () => {
  const logger = { info: vi.fn() };
  let counts = { clients: 0, waiting: 0, sessions: 0 };
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    logger.info.mockReset();
    counts = { clients: 0, waiting: 0, sessions: 0 };
    stop = startStatsLog({ getCounts: () => counts, logger });
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('writes one line a minute while people are connected', () => {
    counts = { clients: 12, waiting: 2, sessions: 5 };

    vi.advanceTimersByTime(STATS_INTERVAL_MS - 1);
    expect(logger.info).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [fields, message] = logger.info.mock.calls[0] ?? [];
    expect(message).toBe('stats');
    expect(fields).toMatchObject({ clients: 12, waiting: 2, sessions: 5 });

    vi.advanceTimersByTime(STATS_INTERVAL_MS);
    expect(logger.info).toHaveBeenCalledTimes(2);
  });

  it('reports how well the server is keeping up, and its memory, as plain numbers', () => {
    counts = { clients: 1, waiting: 0, sessions: 0 };
    vi.advanceTimersByTime(STATS_INTERVAL_MS);

    const [fields] = logger.info.mock.calls[0] ?? [];
    for (const key of ['loopDelayP99Ms', 'loopDelayMaxMs', 'memoryMb']) {
      expect(Number.isInteger(fields[key]), key).toBe(true);
      expect(fields[key], key).toBeGreaterThanOrEqual(0);
    }
  });

  it('logs nothing but counts and measurements', () => {
    counts = { clients: 3, waiting: 1, sessions: 1 };
    vi.advanceTimersByTime(STATS_INTERVAL_MS);

    const [fields] = logger.info.mock.calls[0] ?? [];
    expect(Object.keys(fields).sort()).toEqual([
      'clients',
      'loopDelayMaxMs',
      'loopDelayP99Ms',
      'memoryMb',
      'sessions',
      'waiting',
    ]);
  });

  it('stays quiet while nobody is connected', () => {
    vi.advanceTimersByTime(STATS_INTERVAL_MS * 5);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('stops when asked', () => {
    counts = { clients: 4, waiting: 0, sessions: 2 };
    stop();
    vi.advanceTimersByTime(STATS_INTERVAL_MS * 3);
    expect(logger.info).not.toHaveBeenCalled();
  });
});
