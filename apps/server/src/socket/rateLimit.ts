/**
 * Rate limiting with "token buckets".
 *
 * Picture a bucket that holds up to `burst` tokens and is topped up at `perSecond` tokens
 * every second. Each request must take one token. If the bucket is empty, the request is
 * refused. So a user can do a few things quickly (a burst), but cannot keep going faster
 * than the refill rate.
 *
 * Example: Next has burst 3 and 1 per second. Three quick clicks work. A script pressing
 * Next 100 times a second gets about one through per second and the rest are refused.
 */

export interface RateRule {
  /** How many requests may happen back to back. */
  readonly burst: number;
  /** How many requests per second are allowed over the long run. */
  readonly perSecond: number;
}

export class TokenBucket {
  private readonly rule: RateRule;
  private tokens: number;
  private lastRefillMs: number;

  constructor(rule: RateRule, nowMs: number) {
    this.rule = rule;
    this.tokens = rule.burst;
    this.lastRefillMs = nowMs;
  }

  /** Takes one token if there is one. Returns whether the request is allowed. */
  tryTake(nowMs: number): boolean {
    const elapsedSeconds = Math.max(0, nowMs - this.lastRefillMs) / 1000;
    this.tokens = Math.min(this.rule.burst, this.tokens + elapsedSeconds * this.rule.perSecond);
    this.lastRefillMs = nowMs;

    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/**
 * The limits for one connected browser. Each kind of request has its own bucket, so
 * (for example) a burst of call-setup messages does not use up the chat allowance.
 */
export interface RateLimits {
  join: RateRule;
  next: RateRule;
  leave: RateRule;
  chat: RateRule;
  /** WebRTC setup sends many small messages in a burst (often 20 to 40 ICE candidates). */
  signal: RateRule;
  media: RateRule;
  /**
   * Refused requests (invalid or rate limited) are counted here. A browser that keeps
   * sending bad requests until this bucket is empty gets disconnected.
   */
  strike: RateRule;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  join: { burst: 5, perSecond: 1 },
  next: { burst: 3, perSecond: 1 },
  leave: { burst: 5, perSecond: 1 },
  chat: { burst: 5, perSecond: 2 },
  signal: { burst: 100, perSecond: 30 },
  media: { burst: 6, perSecond: 2 },
  strike: { burst: 30, perSecond: 0.2 },
};

/** One set of buckets. The server creates one of these per connected browser. */
export class RateLimiter {
  private readonly buckets = new Map<keyof RateLimits, TokenBucket>();
  private readonly limits: RateLimits;
  private readonly now: () => number;

  constructor(limits: RateLimits, now: () => number) {
    this.limits = limits;
    this.now = now;
  }

  allow(kind: keyof RateLimits): boolean {
    const nowMs = this.now();
    let bucket = this.buckets.get(kind);
    if (!bucket) {
      bucket = new TokenBucket(this.limits[kind], nowMs);
      this.buckets.set(kind, bucket);
    }
    return bucket.tryTake(nowMs);
  }
}
