import { describe, expect, it } from 'vitest';
import { formatCountdown } from './format.ts';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

describe('formatCountdown', () => {
  it.each([
    [2 * HOUR + 10 * MINUTE + 5 * SECOND, '2 h 10 min'],
    [3 * HOUR, '3 h'],
    [59 * MINUTE + 59 * SECOND, '59 min'],
    [MINUTE, '1 min'],
    [40 * SECOND, '40 s'],
    [1, '1 s'],
    [0, '0 s'],
    [-5000, '0 s'],
  ])('%d ms is shown as "%s"', (durationMs, expected) => {
    expect(formatCountdown(durationMs)).toBe(expected);
  });
});
