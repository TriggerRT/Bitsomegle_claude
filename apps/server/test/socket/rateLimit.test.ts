import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATE_LIMITS,
  RateLimiter,
  type RateLimits,
  TokenBucket,
} from '../../src/socket/rateLimit.ts';

describe('TokenBucket', () => {
  it('allows a burst, then refuses', () => {
    const bucket = new TokenBucket({ burst: 3, perSecond: 1 }, 0);
    expect([bucket.tryTake(0), bucket.tryTake(0), bucket.tryTake(0)]).toEqual([true, true, true]);
    expect(bucket.tryTake(0)).toBe(false);
  });

  it('refills over time at the configured rate', () => {
    const bucket = new TokenBucket({ burst: 2, perSecond: 2 }, 0);
    bucket.tryTake(0);
    bucket.tryTake(0);
    expect(bucket.tryTake(400)).toBe(false); // only 0.8 of a token so far
    expect(bucket.tryTake(500)).toBe(true); // 1 token after half a second
    expect(bucket.tryTake(500)).toBe(false);
  });

  it('never holds more than the burst size, however long it rests', () => {
    const bucket = new TokenBucket({ burst: 2, perSecond: 1 }, 0);
    const oneHour = 3_600_000;
    expect(bucket.tryTake(oneHour)).toBe(true);
    expect(bucket.tryTake(oneHour)).toBe(true);
    expect(bucket.tryTake(oneHour)).toBe(false);
  });

  it('keeps a steady sender at the refill rate', () => {
    const bucket = new TokenBucket({ burst: 3, perSecond: 1 }, 0);
    let allowed = 0;
    // 100 requests per second for 10 seconds.
    for (let ms = 0; ms < 10_000; ms += 10) {
      if (bucket.tryTake(ms)) allowed += 1;
    }
    expect(allowed).toBe(12); // the burst of 3, then about 1 per second
  });

  it('is not confused by a clock that jumps backwards', () => {
    const bucket = new TokenBucket({ burst: 1, perSecond: 1 }, 1000);
    expect(bucket.tryTake(1000)).toBe(true);
    expect(bucket.tryTake(0)).toBe(false);
  });
});

describe('RateLimiter', () => {
  const limits: RateLimits = {
    ...DEFAULT_RATE_LIMITS,
    next: { burst: 1, perSecond: 1 },
    chat: { burst: 2, perSecond: 1 },
  };

  it('keeps a separate allowance for each kind of request', () => {
    let nowMs = 0;
    const limiter = new RateLimiter(limits, () => nowMs);

    expect(limiter.allow('next')).toBe(true);
    expect(limiter.allow('next')).toBe(false);
    // Using up Next does not affect chat.
    expect(limiter.allow('chat')).toBe(true);
    expect(limiter.allow('chat')).toBe(true);
    expect(limiter.allow('chat')).toBe(false);

    nowMs = 1000;
    expect(limiter.allow('next')).toBe(true);
  });

  it('gives each limiter (each browser) its own allowance', () => {
    const first = new RateLimiter(limits, () => 0);
    const second = new RateLimiter(limits, () => 0);
    expect(first.allow('next')).toBe(true);
    expect(first.allow('next')).toBe(false);
    expect(second.allow('next')).toBe(true);
  });
});
