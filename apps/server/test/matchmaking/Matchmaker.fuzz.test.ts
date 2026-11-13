import { describe, expect, it } from 'vitest';
import { Matchmaker } from '../../src/matchmaking/Matchmaker.ts';
import type { ClientView, MatchEffect } from '../../src/matchmaking/types.ts';

/**
 * Randomized ("fuzz") test.
 *
 * Hand-written tests only cover the situations we thought of. This test plays thousands of
 * random sequences of connect / join / Next / leave / disconnect, including duplicate, stale
 * and nonsense requests, and after EVERY step checks two things:
 *
 * 1. The Matchmaker's internal rules still hold (`assertInvariants`).
 * 2. A pretend browser that only knows what it was told through effects has exactly the
 *    same idea of its state as the server. This is the "frontend and backend must agree on
 *    session state" requirement.
 *
 * The randomness comes from a seeded generator, so a failure names the seed and the same
 * sequence can be replayed exactly.
 */

const SEQUENCES = 2000;
const STEPS_PER_SEQUENCE = 150;
/** Kept small on purpose: a crowded handful of clients collides far more often. */
const MAX_CLIENTS = 8;

/** Small deterministic random number generator (mulberry32). Returns numbers in [0, 1). */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How often each interesting situation happened, summed over all sequences. */
const seen = {
  waiting: 0,
  matched: 0,
  partner_next: 0,
  partner_left: 0,
  partner_disconnected: 0,
  staleNextIgnored: 0,
  avoidedPartner: 0,
};

function runSequence(seed: number): void {
  const random = createRandom(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

  let sessionCounter = 0;
  const matchmaker = new Matchmaker({
    generateSessionId: () => {
      sessionCounter += 1;
      return `s${sessionCounter}`;
    },
  });

  /** What each pretend browser believes, built ONLY from its own actions and effects. */
  const views = new Map<string, ClientView>();
  const issuedSessionIds: string[] = [];
  /** Who was in each session, and which pairs must never meet again ('Report & skip'). */
  const sessionMembers = new Map<string, [string, string]>();
  const avoidedPairs = new Set<string>();
  const pairKey = (a: string, b: string): string => [a, b].sort().join('+');
  const history: string[] = [];
  let clientCounter = 0;

  const check = (condition: boolean, message: string): void => {
    if (condition) return;
    const recent = history.slice(-12).join('\n  ');
    throw new Error(`${message}\nseed ${seed}, step ${history.length}. Last steps:\n  ${recent}`);
  };

  const applyEffects = (effects: MatchEffect[]): void => {
    const matchedBySession = new Map<string, MatchEffect[]>();

    for (const effect of effects) {
      const view = views.get(effect.to);
      if (!view) {
        check(false, `effect sent to a client that is not connected: ${JSON.stringify(effect)}`);
        continue;
      }

      if (effect.type === 'waiting') {
        check(view.state === 'idle', `${effect.to} told "waiting" while ${view.state}`);
        view.state = 'waiting';
        seen.waiting += 1;
      } else if (effect.type === 'matched') {
        check(view.state !== 'in_session', `${effect.to} matched while already in a session`);
        view.state = 'in_session';
        view.sessionId = effect.sessionId;
        seen.matched += 1;
        matchedBySession.set(effect.sessionId, [
          ...(matchedBySession.get(effect.sessionId) ?? []),
          effect,
        ]);
      } else {
        check(
          view.state === 'in_session' && view.sessionId === effect.sessionId,
          `${effect.to} told session ${effect.sessionId} ended but believes ${JSON.stringify(view)}`,
        );
        view.state = 'idle';
        view.sessionId = null;
        seen[effect.reason] += 1;
      }
    }

    for (const [sessionId, matched] of matchedBySession) {
      check(!issuedSessionIds.includes(sessionId), `session id ${sessionId} was reused`);
      issuedSessionIds.push(sessionId);
      const [first, second] = matched;
      check(matched.length === 2, `session ${sessionId} announced to ${matched.length} clients`);
      check(first?.to !== second?.to, `session ${sessionId} pairs a client with itself`);
      if (first && second) {
        sessionMembers.set(sessionId, [first.to, second.to]);
        check(
          !avoidedPairs.has(pairKey(first.to, second.to)),
          `${first.to} and ${second.to} were paired again after one avoided the other`,
        );
      }
      const politeCount = matched.filter((e) => e.type === 'matched' && e.polite).length;
      check(politeCount === 1, `session ${sessionId} has ${politeCount} polite peers`);
    }
  };

  const assertServerAndClientsAgree = (): void => {
    try {
      matchmaker.assertInvariants();
    } catch (error) {
      check(false, (error as Error).message);
    }
    check(matchmaker.stats().clients === views.size, 'client count differs');
    for (const [id, view] of views) {
      const actual = matchmaker.getClient(id);
      check(
        actual?.state === view.state && actual.sessionId === view.sessionId,
        `${id}: browser believes ${JSON.stringify(view)}, server says ${JSON.stringify(actual)}`,
      );
    }
  };

  for (let step = 0; step < STEPS_PER_SEQUENCE; step += 1) {
    const connected = [...views.keys()];
    // Mostly real clients, sometimes one that never connected or has already gone.
    const target =
      connected.length > 0 && random() < 0.95
        ? pick(connected)
        : `ghost${Math.floor(random() * 3)}`;
    const view = views.get(target);
    const roll = random();

    if (roll < 0.12 && views.size < MAX_CLIENTS) {
      clientCounter += 1;
      const id = `c${clientCounter}`;
      history.push(`connect ${id}`);
      matchmaker.connect(id);
      views.set(id, { state: 'idle', sessionId: null });
    } else if (roll < 0.15 && view) {
      history.push(`connect ${target} (duplicate)`);
      matchmaker.connect(target);
    } else if (roll < 0.45) {
      history.push(`join ${target}`);
      applyEffects(matchmaker.join(target));
    } else if (roll < 0.8) {
      // Usually the session the browser believes it is in; sometimes an old or made-up one.
      const kind = random();
      const sessionId =
        kind < 0.7 && view?.sessionId
          ? view.sessionId
          : kind < 0.9 && issuedSessionIds.length > 0
            ? pick(issuedSessionIds)
            : 'made-up';
      const avoidPartner = random() < 0.15;
      history.push(`next ${target} ${sessionId}${avoidPartner ? ' (avoid)' : ''}`);
      const isCurrentSession = view?.state === 'in_session' && view.sessionId === sessionId;
      const isStale = view?.state === 'in_session' && view.sessionId !== sessionId;
      // A real browser tears down its call as it sends Next for its current session.
      if (view && isCurrentSession) {
        view.state = 'idle';
        view.sessionId = null;
        const members = sessionMembers.get(sessionId);
        if (avoidPartner && members) {
          avoidedPairs.add(pairKey(...members));
          seen.avoidedPartner += 1;
        }
      }
      const effects = matchmaker.next(target, sessionId, { avoidPartner });
      if (isStale) {
        check(effects.length === 0, `stale Next from ${target} caused ${JSON.stringify(effects)}`);
        seen.staleNextIgnored += 1;
      }
      applyEffects(effects);
    } else if (roll < 0.92) {
      history.push(`leave ${target}`);
      if (view) {
        view.state = 'idle';
        view.sessionId = null;
      }
      applyEffects(matchmaker.leave(target));
    } else {
      history.push(`disconnect ${target}`);
      views.delete(target);
      applyEffects(matchmaker.disconnect(target));
    }

    assertServerAndClientsAgree();
  }
}

describe('Matchmaker under random operations', () => {
  it(`keeps every rule across ${SEQUENCES} random sequences of ${STEPS_PER_SEQUENCE} steps`, () => {
    for (let seed = 1; seed <= SEQUENCES; seed += 1) runSequence(seed);

    // Guard against this test quietly becoming useless: every interesting situation
    // must really have happened many times.
    for (const [situation, count] of Object.entries(seen)) {
      expect(count, `"${situation}" was barely exercised`).toBeGreaterThan(1000);
    }
  });
});
