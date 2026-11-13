import { describe, expect, it } from 'vitest';
import { Matchmaker } from '../../src/matchmaking/Matchmaker.ts';
import type { MatchEffect } from '../../src/matchmaking/types.ts';

/** A matchmaker whose session ids are s1, s2, s3… so tests can name them. */
function createMatchmaker(...clientIds: string[]): Matchmaker {
  let counter = 0;
  const matchmaker = new Matchmaker({
    generateSessionId: () => {
      counter += 1;
      return `s${counter}`;
    },
  });
  for (const id of clientIds) matchmaker.connect(id);
  return matchmaker;
}

/** Runs an operation and checks the rules still hold afterwards. */
function checked(matchmaker: Matchmaker, effects: MatchEffect[]): MatchEffect[] {
  matchmaker.assertInvariants();
  return effects;
}

const IDLE = { state: 'idle', sessionId: null };
const WAITING = { state: 'waiting', sessionId: null };
const inSession = (sessionId: string) => ({ state: 'in_session', sessionId });

describe('Matchmaker', () => {
  describe('connecting', () => {
    it('registers a new client as idle', () => {
      const m = createMatchmaker('a');
      expect(m.getClient('a')).toEqual(IDLE);
      expect(m.stats()).toEqual({ clients: 1, waiting: 0, sessions: 0 });
    });

    it('ignores a second connect for the same client', () => {
      const m = createMatchmaker('a', 'b');
      m.join('a');
      m.connect('a');
      expect(m.getClient('a')).toEqual(WAITING);
      expect(m.stats().clients).toBe(2);
      m.assertInvariants();
    });

    it('knows nothing about a client that never connected', () => {
      const m = createMatchmaker();
      expect(m.getClient('ghost')).toBeUndefined();
    });
  });

  describe('two users matching', () => {
    it('queues the first user and tells them they are waiting', () => {
      const m = createMatchmaker('a', 'b');
      expect(checked(m, m.join('a'))).toEqual([{ type: 'waiting', to: 'a' }]);
      expect(m.getClient('a')).toEqual(WAITING);
    });

    it('pairs the second user with the first and tells both', () => {
      const m = createMatchmaker('a', 'b');
      m.join('a');
      const effects = checked(m, m.join('b'));

      expect(effects).toEqual([
        { type: 'matched', to: 'a', sessionId: 's1', polite: false },
        { type: 'matched', to: 'b', sessionId: 's1', polite: true },
      ]);
      expect(m.getClient('a')).toEqual(inSession('s1'));
      expect(m.getClient('b')).toEqual(inSession('s1'));
      expect(m.stats()).toEqual({ clients: 2, waiting: 0, sessions: 1 });
    });

    it('gives each partner the other as their relay target', () => {
      const m = createMatchmaker('a', 'b');
      m.join('a');
      m.join('b');
      expect(m.getPartner('a', 's1')).toBe('b');
      expect(m.getPartner('b', 's1')).toBe('a');
    });

    it('never matches a lone user with themselves', () => {
      const m = createMatchmaker('a');
      checked(m, m.join('a'));
      checked(m, m.join('a'));
      expect(m.getClient('a')).toEqual(WAITING);
      expect(m.stats().sessions).toBe(0);
    });
  });

  describe('three or more users', () => {
    it('pairs the first two and leaves the third waiting', () => {
      const m = createMatchmaker('a', 'b', 'c');
      m.join('a');
      m.join('b');
      const effects = checked(m, m.join('c'));

      expect(effects).toEqual([{ type: 'waiting', to: 'c' }]);
      expect(m.getClient('c')).toEqual(WAITING);
      expect(m.stats()).toEqual({ clients: 3, waiting: 1, sessions: 1 });
    });

    it('pairs waiting users in first come, first served order', () => {
      const m = createMatchmaker('a', 'b', 'c', 'd');
      m.join('a');
      m.join('b'); // a+b
      m.join('c');
      m.join('d'); // c+d
      expect(m.getPartner('a', 's1')).toBe('b');
      expect(m.getPartner('c', 's2')).toBe('d');
    });

    it('handles many users joining at once: everyone ends up in exactly one pair', () => {
      const ids = Array.from({ length: 10 }, (_, i) => `user${i}`);
      const m = createMatchmaker(...ids);
      for (const id of ids) checked(m, m.join(id));

      expect(m.stats()).toEqual({ clients: 10, waiting: 0, sessions: 5 });
      for (const id of ids) expect(m.getClient(id)?.state).toBe('in_session');
    });

    it('leaves exactly one user waiting when an odd number join', () => {
      const ids = Array.from({ length: 11 }, (_, i) => `user${i}`);
      const m = createMatchmaker(...ids);
      for (const id of ids) checked(m, m.join(id));

      expect(m.stats()).toEqual({ clients: 11, waiting: 1, sessions: 5 });
      expect(m.getClient('user10')).toEqual(WAITING);
    });
  });

  describe('Next', () => {
    it('ends the session, tells the partner, and queues the user who pressed it', () => {
      const m = createMatchmaker('a', 'b');
      m.join('a');
      m.join('b');
      const effects = checked(m, m.next('a', 's1'));

      expect(effects).toEqual([
        { type: 'session_ended', to: 'b', sessionId: 's1', reason: 'partner_next' },
        { type: 'waiting', to: 'a' },
      ]);
      expect(m.getClient('a')).toEqual(WAITING);
      expect(m.getClient('b')).toEqual(IDLE); // b decides for themselves when to continue
    });

    it('matches straight away with someone already waiting', () => {
      const m = createMatchmaker('a', 'b', 'c');
      m.join('a');
      m.join('b');
      m.join('c'); // c waits
      const effects = checked(m, m.next('a', 's1'));

      expect(effects).toEqual([
        { type: 'session_ended', to: 'b', sessionId: 's1', reason: 'partner_next' },
        { type: 'matched', to: 'c', sessionId: 's2', polite: false },
        { type: 'matched', to: 'a', sessionId: 's2', polite: true },
      ]);
      expect(m.getClient('b')).toEqual(IDLE);
    });

    it('lets the partner who was left behind press Next to continue', () => {
      const m = createMatchmaker('a', 'b', 'c');
      m.join('a');
      m.join('b');
      m.next('a', 's1'); // a waits, b idle
      m.join('c'); // a+c in s2
      const effects = checked(m, m.next('b', 's1')); // b's session is long over

      expect(effects).toEqual([{ type: 'waiting', to: 'b' }]);
    });

    it('prefers a new person over the last partner, even if the last partner waited longer', () => {
      const m = createMatchmaker('x', 'y', 'z');
      // Two people can only both be waiting if they avoid each other, so set that up first.
      m.join('x');
      m.join('y'); // x+y in s1
      m.next('x', 's1', { avoidPartner: true }); // queue: x
      m.next('y', 's1'); // queue: x, y
      m.join('z'); // z+x in s2; queue: y
      m.leave('z'); // x and z are now each other's last partner
      m.join('x'); // queue: y, x
      m.leave('y');
      m.join('y'); // queue: x, y (x has waited longest)

      checked(m, m.join('z'));

      expect(m.getPartner('z', 's3')).toBe('y');
      expect(m.getClient('x')).toEqual(WAITING);
    });

    it('re-pairs the same two people when nobody else is online', () => {
      const m = createMatchmaker('a', 'b');
      m.join('a');
      m.join('b');
      m.next('a', 's1');
      const effects = checked(m, m.next('b', 's1'));

      expect(effects).toEqual([
        { type: 'matched', to: 'a', sessionId: 's2', polite: false },
        { type: 'matched', to: 'b', sessionId: 's2', polite: true },
      ]);
    });

    it('with avoidPartner, never pairs those two again', () => {
      const m = createMatchmaker('a', 'b', 'c');
      m.join('a');
      m.join('b');
      checked(m, m.next('a', 's1', { avoidPartner: true }));
      const effects = checked(m, m.next('b', 's1'));

      expect(effects).toEqual([{ type: 'waiting', to: 'b' }]); // not re-paired with a
      expect(m.stats()).toEqual({ clients: 3, waiting: 2, sessions: 0 });

      checked(m, m.join('c')); // c takes the oldest waiter
      expect(m.getPartner('c', 's2')).toBe('a');
      expect(m.getClient('b')).toEqual(WAITING);
    });
  });

  describe('both users pressing Next at the same moment', () => {
    it('the second Next does not end anything a second time', () => {
      const m = createMatchmaker('a', 'b', 'c', 'd');
      m.join('c');
      m.join('d'); // c+d in s1, unrelated bystanders
      m.join('a');
      m.join('b'); // a+b in s2

      checked(m, m.next('a', 's2'));
      const effects = checked(m, m.next('b', 's2'));

      // b's Next found the session already over, so it only looks for a partner.
      expect(effects.filter((e) => e.type === 'session_ended')).toEqual([]);
      expect(m.getClient('c')).toEqual(inSession('s1'));
      expect(m.getClient('d')).toEqual(inSession('s1'));
    });

    it('both end up with a new partner when others are waiting', () => {
      const m = createMatchmaker('a', 'b', 'c', 'd');
      m.join('a');
      m.join('b'); // a+b in s1
      m.join('c'); // waiting
      m.next('a', 's1'); // a+c in s2
      m.join('d'); // waiting
      checked(m, m.next('b', 's1')); // b+d in s3

      expect(m.getPartner('a', 's2')).toBe('c');
      expect(m.getPartner('b', 's3')).toBe('d');
    });
  });

  describe('pressing Next repeatedly', () => {
    it('a double click skips only one partner', () => {
      const m = createMatchmaker('a', 'b', 'c');
      m.join('a');
      m.join('b');
      m.join('c');
      m.next('a', 's1'); // a is now with c in s2
      const effects = checked(m, m.next('a', 's1')); // second click still says s1

      expect(effects).toEqual([]);
      expect(m.getClient('a')).toEqual(inSession('s2'));
      expect(m.getClient('c')).toEqual(inSession('s2'));
    });

    it('does nothing while already waiting', () => {
      const m = createMatchmaker('a', 'b');
      m.join('a');
      m.join('b');
      m.next('a', 's1');
      expect(checked(m, m.next('a', 's1'))).toEqual([]);
      expect(m.stats().waiting).toBe(1);
    });
  });

  describe('leaving', () => {
    it('takes a waiting user out of the queue', () => {
      const m = createMatchmaker('a', 'b');
      m.join('a');
      expect(checked(m, m.leave('a'))).toEqual([]);
      expect(m.getClient('a')).toEqual(IDLE);

      expect(checked(m, m.join('b'))).toEqual([{ type: 'waiting', to: 'b' }]);
    });

    it('ends the session and tells the partner', () => {
      const m = createMatchmaker('a', 'b');
      m.join('a');
      m.join('b');
      const effects = checked(m, m.leave('a'));

      expect(effects).toEqual([
        { type: 'session_ended', to: 'b', sessionId: 's1', reason: 'partner_left' },
      ]);
      expect(m.getClient('a')).toEqual(IDLE);
      expect(m.getClient('b')).toEqual(IDLE);
      expect(m.stats().sessions).toBe(0);
    });

    it('does nothing when already idle', () => {
      const m = createMatchmaker('a');
      expect(checked(m, m.leave('a'))).toEqual([]);
      expect(checked(m, m.leave('a'))).toEqual([]);
    });

    it('lets the user start again afterwards', () => {
      const m = createMatchmaker('a', 'b');
      m.join('a');
      m.join('b');
      m.leave('a');
      expect(checked(m, m.join('a'))).toEqual([{ type: 'waiting', to: 'a' }]);
    });
  });

  describe('disconnecting while waiting', () => {
    it('removes the user so nobody is matched with a ghost', () => {
      const m = createMatchmaker('a', 'b');
      m.join('a');
      expect(checked(m, m.disconnect('a'))).toEqual([]);
      expect(m.getClient('a')).toBeUndefined();

      expect(checked(m, m.join('b'))).toEqual([{ type: 'waiting', to: 'b' }]);
      expect(m.stats()).toEqual({ clients: 1, waiting: 1, sessions: 0 });
    });
  });

  describe('disconnecting while matched', () => {
    it('ends the session and tells the partner', () => {
      const m = createMatchmaker('a', 'b');
      m.join('a');
      m.join('b');
      const effects = checked(m, m.disconnect('a'));

      expect(effects).toEqual([
        { type: 'session_ended', to: 'b', sessionId: 's1', reason: 'partner_disconnected' },
      ]);
      expect(m.getClient('a')).toBeUndefined();
      expect(m.getClient('b')).toEqual(IDLE);
      expect(m.stats()).toEqual({ clients: 1, waiting: 0, sessions: 0 });
    });

    it('lets the partner find someone new', () => {
      const m = createMatchmaker('a', 'b', 'c');
      m.join('a');
      m.join('b');
      m.disconnect('a');
      m.join('c');
      checked(m, m.next('b', 's1'));
      expect(m.getPartner('b', 's2')).toBe('c');
    });
  });

  describe('repeated and duplicate requests', () => {
    it('joining twice while waiting queues the user only once', () => {
      const m = createMatchmaker('a', 'b', 'c');
      m.join('a');
      expect(checked(m, m.join('a'))).toEqual([]);
      expect(m.stats().waiting).toBe(1);

      m.join('b'); // takes the single queue entry for a
      expect(checked(m, m.join('c'))).toEqual([{ type: 'waiting', to: 'c' }]);
    });

    it('joining while in a session does not create a second session', () => {
      const m = createMatchmaker('a', 'b', 'c');
      m.join('a');
      m.join('b');
      expect(checked(m, m.join('a'))).toEqual([]);
      m.join('c');
      expect(m.getClient('a')).toEqual(inSession('s1'));
      expect(m.getClient('c')).toEqual(WAITING);
    });

    it('a duplicate disconnect is harmless', () => {
      const m = createMatchmaker('a', 'b');
      m.join('a');
      m.join('b');
      m.disconnect('a');
      expect(checked(m, m.disconnect('a'))).toEqual([]);
      expect(m.getClient('b')).toEqual(IDLE);
    });
  });

  describe('stale session events', () => {
    it('a Next carrying an old session id does not end the newer session', () => {
      const m = createMatchmaker('a', 'b', 'c');
      m.join('a');
      m.join('b'); // s1
      m.leave('a');
      m.join('c');
      m.join('a'); // c+a in s2

      expect(checked(m, m.next('a', 's1'))).toEqual([]);
      expect(m.getClient('a')).toEqual(inSession('s2'));
      expect(m.getClient('c')).toEqual(inSession('s2'));
    });

    it('a Next carrying a made-up session id does nothing to a live session', () => {
      const m = createMatchmaker('a', 'b');
      m.join('a');
      m.join('b');
      expect(checked(m, m.next('a', 'not-a-session'))).toEqual([]);
      expect(m.getClient('a')).toEqual(inSession('s1'));
    });

    it('refuses to relay a message that belongs to an old session', () => {
      const m = createMatchmaker('a', 'b', 'c');
      m.join('a');
      m.join('b'); // s1
      m.join('c');
      m.next('a', 's1'); // a+c in s2

      expect(m.getPartner('a', 's1')).toBeNull(); // late message meant for b
      expect(m.getPartner('b', 's1')).toBeNull(); // b's session is over
      expect(m.getPartner('a', 's2')).toBe('c');
    });

    it('refuses to relay into a session the sender is not part of', () => {
      const m = createMatchmaker('a', 'b', 'c');
      m.join('a');
      m.join('b');
      expect(m.getPartner('c', 's1')).toBeNull();
      expect(m.getPartner('ghost', 's1')).toBeNull();
    });
  });

  describe('events from clients that are not connected', () => {
    it('are ignored', () => {
      const m = createMatchmaker('a');
      m.join('a');
      expect(checked(m, m.join('ghost'))).toEqual([]);
      expect(checked(m, m.next('ghost', 's1'))).toEqual([]);
      expect(checked(m, m.leave('ghost'))).toEqual([]);
      expect(checked(m, m.disconnect('ghost'))).toEqual([]);
      expect(m.stats()).toEqual({ clients: 1, waiting: 1, sessions: 0 });
    });
  });

  describe('session ids', () => {
    it('are random and unique by default', () => {
      const m = new Matchmaker();
      const ids = new Set<string>();
      for (let i = 0; i < 50; i += 1) {
        m.connect(`a${i}`);
        m.connect(`b${i}`);
        m.join(`a${i}`);
        for (const effect of m.join(`b${i}`)) {
          if (effect.type === 'matched') ids.add(effect.sessionId);
        }
      }
      expect(ids.size).toBe(50);
    });
  });
});
