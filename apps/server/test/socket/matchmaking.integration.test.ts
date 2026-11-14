import type { MatchedPayload, SessionEndedPayload } from '@bitsomeggle/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pair, startTestServer, type TestClient, type TestServer } from './helpers.ts';

describe('matchmaking over real connections', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.stop();
  });

  /** Waits until the server has noticed a connection closing. */
  const waitForClientCount = (count: number) =>
    vi.waitFor(() => expect(server.app.matchmaker.stats().clients).toBe(count));

  it('sends the site status as soon as a browser connects', async () => {
    const a = await server.connect();
    expect(a.status).toEqual({ open: true, opensAt: null, closesAt: null, online: 1 });

    const b = await server.connect();
    expect(b.status.online).toBe(2);
  });

  it('matches two users and tells both, with one polite and one impolite', async () => {
    const a = await server.connect();
    const b = await server.connect();

    expect(await a.request('queue:join')).toEqual({ ok: true });
    await a.next('queue:waiting');

    expect(await b.request('queue:join')).toEqual({ ok: true });
    const forA = await a.next<MatchedPayload>('session:matched');
    const forB = await b.next<MatchedPayload>('session:matched');

    expect(forA.sessionId).toBe(forB.sessionId);
    expect(forA.sessionId).toMatch(/^[0-9a-f-]{36}$/); // a random UUID
    expect([forA.polite, forB.polite].sort()).toEqual([false, true]);
  });

  it('gives both browsers the same list of call-setup servers', async () => {
    const a = await server.connect();
    const b = await server.connect();
    await a.request('queue:join');
    await b.request('queue:join');
    const forA = await a.next<MatchedPayload>('session:matched');
    const forB = await b.next<MatchedPayload>('session:matched');

    expect(forA.iceServers).toEqual([{ urls: 'stun:stun.cloudflare.com:3478' }]);
    expect(forB.iceServers).toEqual(forA.iceServers);
  });

  it('never tells a browser who its partner is', async () => {
    const a = await server.connect();
    const b = await server.connect();
    await pair(a, b);

    const everythingASaw = JSON.stringify(a.log);
    expect(everythingASaw).not.toContain(b.id);
  });

  it('leaves a third user waiting', async () => {
    const a = await server.connect();
    const b = await server.connect();
    const c = await server.connect();
    await pair(a, b);

    await c.request('queue:join');
    await c.next('queue:waiting');
    await c.sync();
    expect(c.unreadCount('session:matched')).toBe(0);
    expect(server.app.matchmaker.stats()).toEqual({ clients: 3, waiting: 1, sessions: 1 });
  });

  it('Next ends the session, tells the partner, and finds someone new', async () => {
    const a = await server.connect();
    const b = await server.connect();
    const c = await server.connect();
    const first = await pair(a, b);
    await c.request('queue:join');
    await c.next('queue:waiting');

    expect(await a.request('session:next', { sessionId: first })).toEqual({ ok: true });

    expect(await b.next<SessionEndedPayload>('session:ended')).toEqual({
      sessionId: first,
      reason: 'partner_next',
    });
    const forA = await a.next<MatchedPayload>('session:matched');
    const forC = await c.next<MatchedPayload>('session:matched');
    expect(forA.sessionId).toBe(forC.sessionId);
    expect(forA.sessionId).not.toBe(first);
  });

  it('the partner who was left can press Next to carry on', async () => {
    const a = await server.connect();
    const b = await server.connect();
    const first = await pair(a, b);

    await a.request('session:next', { sessionId: first });
    await a.next('queue:waiting');
    await b.next('session:ended');

    // b still names the old session; the server understands it is over and queues b.
    expect(await b.request('session:next', { sessionId: first })).toEqual({ ok: true });
    const forB = await b.next<MatchedPayload>('session:matched');
    expect(forB.sessionId).not.toBe(first);
  });

  it('when both press Next at the same moment, each gets one clean ending', async () => {
    const a = await server.connect();
    const b = await server.connect();
    const first = await pair(a, b);

    const replies = await Promise.all([
      a.request('session:next', { sessionId: first }),
      b.request('session:next', { sessionId: first }),
    ]);
    expect(replies).toEqual([{ ok: true }, { ok: true }]);

    await Promise.all([a.sync(), b.sync()]);
    server.app.matchmaker.assertInvariants();
    for (const client of [a, b]) {
      const endings = client.log.filter((entry) => entry.event === 'session:ended');
      expect(endings.length).toBeLessThanOrEqual(1);
      expect(server.app.matchmaker.getClient(client.id)).toEqual(client.viewFromEvents());
    }
  });

  it('a double click on Next skips only one partner', async () => {
    const a = await server.connect();
    const b = await server.connect();
    const c = await server.connect();
    const first = await pair(a, b);
    await c.request('queue:join');
    await c.next('queue:waiting');

    // Two Nexts sent back to back, both naming the first session.
    const replies = await Promise.all([
      a.request('session:next', { sessionId: first }),
      a.request('session:next', { sessionId: first }),
    ]);
    expect(replies).toEqual([{ ok: true }, { ok: true }]);

    const forC = await c.next<MatchedPayload>('session:matched');
    await c.sync();
    expect(c.unreadCount('session:ended')).toBe(0); // c was not skipped unseen
    expect(server.app.matchmaker.getPartner(a.id, forC.sessionId)).toBe(c.id);
  });

  it('joining repeatedly queues the user only once', async () => {
    const a = await server.connect();

    const replies = await Promise.all([
      a.request('queue:join'),
      a.request('queue:join'),
      a.request('queue:join'),
    ]);
    expect(replies).toEqual([{ ok: true }, { ok: true }, { ok: true }]);

    await a.sync();
    expect(a.log.filter((entry) => entry.event === 'queue:waiting')).toHaveLength(1);
    expect(server.app.matchmaker.stats().waiting).toBe(1);
  });

  it('Leave ends the session and tells the partner', async () => {
    const a = await server.connect();
    const b = await server.connect();
    const sessionId = await pair(a, b);

    expect(await a.request('leave')).toEqual({ ok: true });
    expect(await b.next<SessionEndedPayload>('session:ended')).toEqual({
      sessionId,
      reason: 'partner_left',
    });
    expect(server.app.matchmaker.getClient(a.id)).toEqual({ state: 'idle', sessionId: null });
  });

  it('Leave takes a waiting user out of the queue', async () => {
    const a = await server.connect();
    const b = await server.connect();
    await a.request('queue:join');
    await a.request('leave');

    await b.request('queue:join');
    await b.next('queue:waiting');
    await b.sync();
    expect(b.unreadCount('session:matched')).toBe(0);
  });

  it('a user who disconnects while waiting is not matched with anyone', async () => {
    const a = await server.connect();
    const b = await server.connect();
    await a.request('queue:join');
    await a.next('queue:waiting');

    a.close();
    await waitForClientCount(1);

    await b.request('queue:join');
    await b.next('queue:waiting');
    await b.sync();
    expect(b.unreadCount('session:matched')).toBe(0);
    server.app.matchmaker.assertInvariants();
  });

  it('a user who disconnects while matched ends the session for the partner', async () => {
    const a = await server.connect();
    const b = await server.connect();
    const sessionId = await pair(a, b);

    a.close();

    expect(await b.next<SessionEndedPayload>('session:ended')).toEqual({
      sessionId,
      reason: 'partner_disconnected',
    });
    await waitForClientCount(1);
    expect(server.app.matchmaker.stats()).toEqual({ clients: 1, waiting: 0, sessions: 0 });
  });

  it('survives 40 users joining and pressing Next at once, for several rounds', async () => {
    const clients: TestClient[] = await Promise.all(
      Array.from({ length: 40 }, () => server.connect()),
    );

    const checkEveryoneAgreesWithServer = async (): Promise<void> => {
      await Promise.all(clients.map((client) => client.sync()));
      server.app.matchmaker.assertInvariants();
      for (const client of clients) {
        expect(client.viewFromEvents()).toEqual(server.app.matchmaker.getClient(client.id));
      }
    };

    await Promise.all(clients.map((client) => client.request('queue:join')));
    await checkEveryoneAgreesWithServer();
    expect(server.app.matchmaker.stats()).toEqual({ clients: 40, waiting: 0, sessions: 20 });

    for (let round = 0; round < 5; round += 1) {
      // Everyone presses Next at the same time, each naming the session they believe they
      // are in. Half of these requests arrive after the partner already ended the session.
      await Promise.all(
        clients.map((client) =>
          client.request('session:next', {
            sessionId: client.viewFromEvents().sessionId ?? 'none',
          }),
        ),
      );
      await checkEveryoneAgreesWithServer();
    }

    // Each session was announced to exactly two browsers, one polite and one not.
    const announcements = new Map<string, boolean[]>();
    for (const client of clients) {
      for (const { event, payload } of client.log) {
        if (event !== 'session:matched') continue;
        const { sessionId, polite } = payload as MatchedPayload;
        announcements.set(sessionId, [...(announcements.get(sessionId) ?? []), polite]);
      }
    }
    expect(announcements.size).toBeGreaterThan(20);
    for (const politeFlags of announcements.values()) {
      expect([...politeFlags].sort()).toEqual([false, true]);
    }
  });
});
