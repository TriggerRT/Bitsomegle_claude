/**
 * Remembers who reported whom, and puts someone reported by several different people
 * into a short "cooldown" during which they cannot be matched.
 *
 * AN HONEST LIMIT: Bitsomeggle has no accounts, so "someone" here means one connection.
 * Reloading the page gives a new connection with a clean record. This slows down a
 * careless offender and tells them their behaviour was noticed; it cannot stop a
 * determined one. Stopping those needs identity (for example BITS email sign-in,
 * docs/DECISIONS.md D-012).
 *
 * Why several DIFFERENT reporters are required: one person could otherwise get anyone
 * blocked by reporting them. Each reporter must also really have been matched with the
 * person (the socket layer checks that before calling `record`).
 */
export interface ReportTrackerOptions {
  /** How many different people must report someone... */
  threshold: number;
  /** ...within this long... */
  windowMs: number;
  /** ...for them to be blocked from matching for this long. */
  cooldownMs: number;
}

export const DEFAULT_REPORT_RULES: ReportTrackerOptions = {
  threshold: 3,
  windowMs: 15 * 60 * 1000,
  cooldownMs: 10 * 60 * 1000,
};

export interface ReportOutcome {
  /** False if this reporter had already reported this person recently. */
  isNew: boolean;
  /** Set if THIS report pushed the person over the threshold: when their cooldown ends. */
  cooldownStartedUntil: number | null;
}

export class ReportTracker {
  private readonly rules: ReportTrackerOptions;
  /** reported person -> (reporter -> when). */
  private readonly reportsAgainst = new Map<string, Map<string, number>>();
  private readonly cooldowns = new Map<string, number>();

  constructor(rules: ReportTrackerOptions = DEFAULT_REPORT_RULES) {
    this.rules = rules;
  }

  record(reporter: string, reported: string, now: number): ReportOutcome {
    const reporters = this.reportsAgainst.get(reported) ?? new Map<string, number>();
    this.reportsAgainst.set(reported, reporters);

    // Reports older than the window no longer count.
    for (const [who, at] of reporters) {
      if (now - at >= this.rules.windowMs) reporters.delete(who);
    }

    const isNew = !reporters.has(reporter);
    reporters.set(reporter, now);

    const alreadyCooling = this.cooldownUntil(reported, now) !== null;
    if (!isNew || alreadyCooling || reporters.size < this.rules.threshold) {
      return { isNew, cooldownStartedUntil: null };
    }
    const until = now + this.rules.cooldownMs;
    this.cooldowns.set(reported, until);
    // Start counting afresh: after the cooldown it takes new reports to trigger another.
    reporters.clear();
    return { isNew, cooldownStartedUntil: until };
  }

  /** When this person's cooldown ends, or null if they are free to be matched. */
  cooldownUntil(clientId: string, now: number): number | null {
    const until = this.cooldowns.get(clientId);
    if (until === undefined) return null;
    if (now >= until) {
      this.cooldowns.delete(clientId);
      return null;
    }
    return until;
  }

  /** Forgets everything about a connection that has gone. Its id is never used again. */
  forget(clientId: string): void {
    this.reportsAgainst.delete(clientId);
    this.cooldowns.delete(clientId);
  }

  /** How many people have records here (for tests: nothing may pile up forever). */
  get size(): number {
    return this.reportsAgainst.size + this.cooldowns.size;
  }
}
