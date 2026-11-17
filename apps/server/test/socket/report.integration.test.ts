/**
 * "Report and skip", against a real server with pretend browsers.
 */
import type { MatchedPayload, SessionEndedPayload } from '@bitsomeggle/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseOpenWindows } from '../../src/schedule/openHours.ts';
import { DEFAULT_RATE_LIMITS } from '../../src/socket/rateLimit.ts';
import { pair, startTestServer, type TestClient, type TestServer } from './helpers.ts';

const MINUTE = 60_000;

describe('report and skip', () => {
  let server: TestServer;

  afterEach(async () => {
    await server.stop();
  });

  it('ends the chat, looks for someone new, and never pairs the two again', async () => {
    server = await startTestServer();
    const a = await server.connect();
    const b = await server.connect();
    const sessionId = await pair(a, b);

    expect(await a.request('report', { sessionId, reason: 'inappropriate' })).toEqual({ ok: true });

    // The reported person is told exactly what an ordinary Next would tell them.
    expect(await b.next<SessionEndedPayload>('session:ended')).toEqual({
      sessionId,
      reason: 'partner_next',
    });
    await a.next('queue:waiting');

    // b looks again. a is waiting, but they must not meet.
    await b.request('queue:join');
    await b.next('queue:waiting');
    await a.sync();
    expect(a.unreadCount('session:matched')).toBe(0);
    expect(server.app.matchmaker.stats()).toMatchObject({ waiting: 2, sessions: 0 });

    // A third person is matched with one of them as usual.
    const c = await server.connect();
    await c.request('queue:join');
    await c.next<MatchedPayload>('session:matched');
    server.app.matchmaker.assertInvariants();
  });

  it('the reported person is not told they were reported', async () => {
    server = await startTestServer();
    const a = await server.connect();
    const b = await server.connect();
    const sessionId = await pair(a, b);

    await a.request('report', { sessionId, reason: 'harassment' });
    await b.next('session:ended');
    await b.sync();

    const told = JSON.stringify(b.log);
    expect(told).not.toContain('report');
    expect(told).not.toContain('harassment');
    expect(told).not.toContain('moderation');
  });

  it('someone who left first can still be reported, and it changes nothing else', async () => {
    server = await startTestServer();
    const a = await server.connect();
    const b = await server.connect();
    const sessionId = await pair(a, b);
    await b.request('session:next', { sessionId }); // b skips a
    await a.next('session:ended');

    expect(await a.request('report', { sessionId, reason: 'inappropriate' })).toEqual({ ok: true });

    await a.sync();
    expect(a.unreadCount('queue:waiting')).toBe(0); // reporting did not start a search
    expect(server.app.matchmaker.getClient(a.id)).toMatchObject({ state: 'idle' });
    // And they are not paired again.
    await a.request('queue:join');
    await a.next('queue:waiting');
    await b.sync();
    expect(b.unreadCount('session:matched')).toBe(0);
  });

  it.each([
    ['a made-up session', () => 'no-such-session'],
    ["other people's session", (id: string) => id],
  ])('refuses a report about %s', async (_name, pickSession) => {
    server = await startTestServer();
    const a = await server.connect();
    const b = await server.connect();
    const outsider = await server.connect();
    const sessionId = await pair(a, b);

    expect(
      await outsider.request('report', { sessionId: pickSession(sessionId), reason: 'spam' }),
    ).toEqual({ ok: false, code: 'not_in_session' });

    await b.sync();
    expect(b.unreadCount('session:ended')).toBe(0);
    expect(server.app.matchmaker.stats().sessions).toBe(1);
  });

  it.each([
    ['no reason', { sessionId: 's' }],
    ['a reason that is not on the list', { sessionId: 's', reason: 'i just dislike them' }],
    ['free text added', { reason: 'spam' }],
  ])('refuses a report with %s as invalid', async (_name, payload) => {
    server = await startTestServer();
    const a = await server.connect();
    expect(await a.request('report', payload)).toEqual({ ok: false, code: 'invalid' });
  });

  it('records each report once, with ids and the chosen reason and nothing else', async () => {
    const moderation = { report: vi.fn(), cooldown: vi.fn() };
    server = await startTestServer({}, { moderation });
    const a = await server.connect();
    const b = await server.connect();
    const sessionId = await pair(a, b);
    await a.request('chat:send', { sessionId, text: 'a private message' });

    await a.request('report', { sessionId, reason: 'harassment' });
    await a.request('report', { sessionId, reason: 'spam' }); // the same person again

    expect(moderation.report).toHaveBeenCalledTimes(1);
    expect(moderation.report).toHaveBeenCalledWith({
      reporter: a.id,
      reported: b.id,
      sessionId,
      reason: 'harassment',
    });
    expect(moderation.cooldown).not.toHaveBeenCalled();
  });

  it('records nothing for a report that was refused', async () => {
    const moderation = { report: vi.fn(), cooldown: vi.fn() };
    server = await startTestServer({}, { moderation });
    const a = await server.connect();

    await a.request('report', { sessionId: 'not-mine', reason: 'spam' });

    expect(moderation.report).not.toHaveBeenCalled();
  });

  it('forgets reports about people who have left, so nothing piles up', async () => {
    server = await startTestServer();
    const a = await server.connect();
    const b = await server.connect();
    const sessionId = await pair(a, b);
    await a.request('report', { sessionId, reason: 'spam' });
    expect(server.app.reports.size).toBe(1);

    b.close();
    await expect.poll(() => server.app.reports.size).toBe(0);
  });

  it('limits how fast one person can send reports', async () => {
    server = await startTestServer({}, { rateLimits: DEFAULT_RATE_LIMITS });
    const a = await server.connect();
    const replies = [];
    for (let i = 0; i < 5; i += 1) {
      replies.push(await a.request('report', { sessionId: 'x', reason: 'spam' }));
    }
    expect(replies.slice(0, 3).every((reply) => !reply.ok && reply.code === 'not_in_session')).toBe(
      true,
    );
    expect(replies[4]).toEqual({ ok: false, code: 'rate_limited' });
  });

  it('while the site is closed, the report is taken and the chat ends, but no new search starts', async () => {
    const HOUR = 3_600_000;
    const ist = (hours: number): number => Date.UTC(2026, 10, 14, hours) - 5.5 * HOUR;
    let nowMs = ist(22);
    server = await startTestServer(
      { openWindows: parseOpenWindows('21:00-23:00') },
      { now: () => nowMs },
    );
    const a = await server.connect();
    const b = await server.connect();
    const sessionId = await pair(a, b);
    nowMs = ist(23.5); // closing time has passed; the chat was allowed to continue

    expect(await a.request('report', { sessionId, reason: 'spam' })).toEqual({
      ok: false,
      code: 'closed',
    });

    await b.next('session:ended');
    expect(server.app.matchmaker.getClient(a.id)).toMatchObject({ state: 'idle' });
  });

  it('while the site is closed, someone who already left can still be reported', async () => {
    const HOUR = 3_600_000;
    const ist = (hours: number): number => Date.UTC(2026, 10, 14, hours) - 5.5 * HOUR;
    let nowMs = ist(22);
    server = await startTestServer(
      { openWindows: parseOpenWindows('21:00-23:00') },
      { now: () => nowMs },
    );
    const a = await server.connect();
    const b = await server.connect();
    const sessionId = await pair(a, b);
    nowMs = ist(23.5);
    await b.request('leave');
    await a.next('session:ended');

    // Nothing has to be found for the reporter here, so "closed" does not apply.
    expect(await a.request('report', { sessionId, reason: 'spam' })).toEqual({ ok: true });
  });

  describe('a cooldown after three different people report the same person', () => {
    let nowMs: number;
    let offender: TestClient;

    /** Matches `reporter` with the offender and has them report. */
    async function reportOffender(reporter: TestClient): Promise<void> {
      await reporter.request('queue:join');
      await reporter.next('queue:waiting');
      await offender.request('queue:join');
      const { sessionId } = await reporter.next<MatchedPayload>('session:matched');
      await offender.next('session:matched');
      // The reporter must not be requeued into the offender's path again; leave after.
      await reporter.request('report', { sessionId, reason: 'inappropriate' });
      await offender.next('session:ended');
      await reporter.request('leave');
    }

    async function startWithThreeReports(): Promise<void> {
      nowMs = Date.UTC(2026, 10, 16, 12);
      server = await startTestServer({}, { now: () => nowMs });
      offender = await server.connect();
      for (let i = 0; i < 3; i += 1) await reportOffender(await server.connect());
    }

    it('is recorded once', async () => {
      const moderation = { report: vi.fn(), cooldown: vi.fn() };
      nowMs = Date.UTC(2026, 10, 16, 12);
      server = await startTestServer({}, { now: () => nowMs, moderation });
      offender = await server.connect();
      for (let i = 0; i < 3; i += 1) await reportOffender(await server.connect());

      expect(moderation.report).toHaveBeenCalledTimes(3);
      expect(moderation.cooldown).toHaveBeenCalledTimes(1);
      expect(moderation.cooldown).toHaveBeenCalledWith({
        client: offender.id,
        until: nowMs + 10 * MINUTE,
      });
    });

    it('tells the offender and refuses to match them', async () => {
      await startWithThreeReports();

      expect(await offender.next('moderation:cooldown')).toEqual({ until: nowMs + 10 * MINUTE });
      expect(await offender.request('queue:join')).toEqual({ ok: false, code: 'cooldown' });
      expect(server.app.matchmaker.getClient(offender.id)).toMatchObject({ state: 'idle' });
    });

    it('does not start after only two reports', async () => {
      nowMs = Date.UTC(2026, 10, 16, 12);
      server = await startTestServer({}, { now: () => nowMs });
      offender = await server.connect();
      for (let i = 0; i < 2; i += 1) await reportOffender(await server.connect());

      await offender.sync();
      expect(offender.unreadCount('moderation:cooldown')).toBe(0);
      expect(await offender.request('queue:join')).toEqual({ ok: true });
    });

    it('takes the offender out of a chat they had already moved on to', async () => {
      nowMs = Date.UTC(2026, 10, 16, 12);
      server = await startTestServer({}, { now: () => nowMs });
      offender = await server.connect();
      await reportOffender(await server.connect());
      await reportOffender(await server.connect());

      // The third reporter is skipped by the offender and reports afterwards. By then the
      // offender is already talking to someone else.
      const third = await server.connect();
      const firstSession = await pair(third, offender);
      await offender.request('session:next', { sessionId: firstSession });
      await third.next('session:ended');
      const bystander = await server.connect();
      await bystander.request('queue:join');
      const { sessionId: newSession } = await bystander.next<MatchedPayload>('session:matched');

      await third.request('report', { sessionId: firstSession, reason: 'inappropriate' });

      expect(await bystander.next<SessionEndedPayload>('session:ended')).toEqual({
        sessionId: newSession,
        reason: 'partner_left',
      });
      await offender.next('moderation:cooldown');
      server.app.matchmaker.assertInvariants();
    });

    it('also blocks Next and Report from finding the offender a new partner', async () => {
      await startWithThreeReports();
      await offender.next('moderation:cooldown');

      expect(await offender.request('session:next', { sessionId: 'whatever' })).toEqual({
        ok: false,
        code: 'cooldown',
      });
    });

    it('ends by itself after ten minutes', async () => {
      await startWithThreeReports();

      nowMs += 10 * MINUTE - 1;
      expect(await offender.request('queue:join')).toEqual({ ok: false, code: 'cooldown' });
      nowMs += 1;
      expect(await offender.request('queue:join')).toEqual({ ok: true });
    });

    it('is not caused by one person reporting three times', async () => {
      nowMs = Date.UTC(2026, 10, 16, 12);
      server = await startTestServer({}, { now: () => nowMs });
      offender = await server.connect();
      const reporter = await server.connect();
      const sessionId = await pair(reporter, offender);

      for (let i = 0; i < 3; i += 1) {
        await reporter.request('report', { sessionId, reason: 'spam' });
      }

      await offender.sync();
      expect(offender.unreadCount('moderation:cooldown')).toBe(0);
    });
  });
});
