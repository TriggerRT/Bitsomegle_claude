import type { SessionEndedPayload, StatusPayload } from '@bitsomeggle/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { parseOpenWindows } from '../../src/schedule/openHours.ts';
import { DEFAULT_RATE_LIMITS } from '../../src/socket/rateLimit.ts';
import { MAX_MESSAGE_BYTES } from '../../src/socket/socketServer.ts';
import { pair, startTestServer, type TestServer } from './helpers.ts';

describe('protection against bad or excessive requests', () => {
  let server: TestServer;

  afterEach(async () => {
    await server.stop();
  });

  describe('malformed payloads', () => {
    it.each([
      ['session:next', undefined],
      ['session:next', null],
      ['session:next', 'not-an-object'],
      ['session:next', {}],
      ['session:next', { sessionId: 12345 }],
      ['session:next', { sessionId: 'x'.repeat(500) }],
      ['chat:send', { sessionId: 's' }],
      ['chat:send', { sessionId: 's', text: '' }],
      ['chat:send', { sessionId: 's', text: '    ' }],
      ['chat:send', { sessionId: 's', text: 'a'.repeat(1001) }],
      ['chat:send', { sessionId: 's', text: ['an', 'array'] }],
      ['chat:send', [1, 2, 3]],
    ])('%s with %j is refused as invalid', async (event, payload) => {
      server = await startTestServer();
      const a = await server.connect();
      expect(await a.request(event, payload)).toEqual({ ok: false, code: 'invalid' });
    });

    it('reports an invalid request that has no reply callback', async () => {
      server = await startTestServer();
      const a = await server.connect();

      a.send('signal', { sessionId: 's', description: { type: 'nonsense' } });

      expect(await a.next('server:error')).toEqual({ code: 'invalid' });
    });

    it('does not act on an invalid Next', async () => {
      server = await startTestServer();
      const a = await server.connect();
      const b = await server.connect();
      await pair(a, b);

      await a.request('session:next', { session: 'wrong-field-name' });

      await b.sync();
      expect(b.unreadCount('session:ended')).toBe(0);
      expect(server.app.matchmaker.stats().sessions).toBe(1);
    });

    it('ignores events it has never heard of and keeps working', async () => {
      server = await startTestServer();
      const a = await server.connect();
      const b = await server.connect();

      a.send('admin:shutdown', { now: true });
      a.send('session:matched', { sessionId: 'fake', polite: true });
      a.send('__proto__', { polluted: true });

      await pair(a, b);
      server.app.matchmaker.assertInvariants();
    });

    it('handles strange arguments without crashing', async () => {
      server = await startTestServer();
      const a = await server.connect();
      const b = await server.connect();

      a.send('queue:join', 'unexpected', { extra: 'arguments' }, 42);
      a.send('leave', null, null);
      a.send('chat:send');
      a.send('signal', 1, 2, 3, 4, 5);
      await a.sync();

      // The server is still healthy and still serves other users.
      const health = await fetch(`${server.url}/health`);
      expect(health.status).toBe(200);
      expect(await b.request('queue:join')).toEqual({ ok: true });
    });

    it('disconnects a browser that sends an oversized message, and nobody else', async () => {
      server = await startTestServer();
      const a = await server.connect();
      const b = await server.connect();
      const sessionId = await pair(a, b);

      a.send('chat:send', { sessionId, text: 'x'.repeat(MAX_MESSAGE_BYTES + 1) });

      await a.waitUntilDisconnected();
      expect(await b.next<SessionEndedPayload>('session:ended')).toEqual({
        sessionId,
        reason: 'partner_disconnected',
      });
      expect(b.unreadCount('chat:message')).toBe(0);
    });
  });

  describe('rate limits', () => {
    it('refuses Next when pressed faster than the limit', async () => {
      server = await startTestServer({}, { rateLimits: DEFAULT_RATE_LIMITS });
      const a = await server.connect();

      const replies = await Promise.all(
        Array.from({ length: 10 }, () => a.request('session:next', { sessionId: 'none' })),
      );

      const allowed = replies.filter((reply) => reply.ok).length;
      expect(allowed).toBeGreaterThanOrEqual(DEFAULT_RATE_LIMITS.next.burst);
      expect(allowed).toBeLessThan(10);
      expect(replies).toContainEqual({ ok: false, code: 'rate_limited' });
    });

    it('limits one browser without affecting another', async () => {
      server = await startTestServer({}, { rateLimits: DEFAULT_RATE_LIMITS });
      const noisy = await server.connect();
      const quiet = await server.connect();

      await Promise.all(Array.from({ length: 20 }, () => noisy.request('queue:join')));

      expect(await quiet.request('queue:join')).toEqual({ ok: true });
    });

    it('drops chat messages over the limit instead of relaying them', async () => {
      server = await startTestServer({}, { rateLimits: DEFAULT_RATE_LIMITS });
      const a = await server.connect();
      const b = await server.connect();
      const sessionId = await pair(a, b);

      const replies = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          a.request('chat:send', { sessionId, text: `spam ${i}` }),
        ),
      );
      const delivered = replies.filter((reply) => reply.ok).length;

      expect(delivered).toBeLessThan(20);
      // b received exactly the messages that were accepted. (b cannot use sync() here,
      // because a message arriving is itself what we are counting.)
      for (let i = 0; i < delivered; i += 1) await b.next('chat:message');
      await a.request('leave');
      await b.next('session:ended');
      expect(b.unreadCount('chat:message')).toBe(0);
    });

    it('disconnects a browser that keeps sending bad requests', async () => {
      server = await startTestServer({}, { rateLimits: DEFAULT_RATE_LIMITS });
      const flooder = await server.connect();
      const other = await server.connect();

      for (let i = 0; i < 200; i += 1) flooder.send('chat:send', { nonsense: i });

      await flooder.waitUntilDisconnected();
      expect(await other.request('queue:join')).toEqual({ ok: true });
      server.app.matchmaker.assertInvariants();
    });
  });

  describe('server capacity', () => {
    it('refuses new connections when full, and accepts them again when someone leaves', async () => {
      server = await startTestServer({ maxClients: 2 });
      const a = await server.connect();
      await server.connect();

      const third = server.connectRaw();
      await expect(third.waitUntilConnected()).rejects.toThrow('server_full');

      a.close();
      await expect.poll(() => server.app.matchmaker.stats().clients).toBe(1);
      const fourth = await server.connect();
      expect(fourth.status.online).toBe(2);
    });
  });

  describe('opening hours', () => {
    const HOUR = 3_600_000;
    /** The moment clocks in India show this hour on 14 Nov 2026. */
    const ist = (hours: number): number => Date.UTC(2026, 10, 14, hours) - 5.5 * HOUR;
    const openWindows = parseOpenWindows('21:00-23:00');

    it('refuses to start matchmaking while closed, and says when it opens', async () => {
      server = await startTestServer({ openWindows }, { now: () => ist(15) });
      const a = await server.connect();

      expect(a.status).toMatchObject({ open: false, opensAt: ist(21), closesAt: null });
      expect(await a.request('queue:join')).toEqual({ ok: false, code: 'closed' });
      expect(server.app.matchmaker.stats().waiting).toBe(0);
    });

    it('matches normally while open, and says when it closes', async () => {
      server = await startTestServer({ openWindows }, { now: () => ist(22) });
      const a = await server.connect();
      const b = await server.connect();

      expect(a.status).toMatchObject({ open: true, opensAt: null, closesAt: ist(23) });
      await pair(a, b);
    });

    it('after closing time: the call continues, but Next ends it without a new match', async () => {
      let nowMs = ist(22);
      server = await startTestServer({ openWindows }, { now: () => nowMs });
      const a = await server.connect();
      const b = await server.connect();
      const c = await server.connect();
      const sessionId = await pair(a, b);

      nowMs = ist(23) + 1; // closing time passes

      // The conversation in progress still works.
      expect(await a.request('chat:send', { sessionId, text: 'still here' })).toEqual({ ok: true });
      await b.next('chat:message');

      // Nobody new can start.
      expect(await c.request('queue:join')).toEqual({ ok: false, code: 'closed' });

      // Next ends the call as asked, and reports that the site is closed.
      expect(await a.request('session:next', { sessionId })).toEqual({ ok: false, code: 'closed' });
      expect(await b.next<SessionEndedPayload>('session:ended')).toEqual({
        sessionId,
        reason: 'partner_left',
      });
      expect(server.app.matchmaker.stats()).toEqual({ clients: 3, waiting: 0, sessions: 0 });
    });

    it('a stale Next after closing time does not end a newer session', async () => {
      let nowMs = ist(22);
      server = await startTestServer({ openWindows }, { now: () => nowMs });
      const a = await server.connect();
      const b = await server.connect();
      const current = await pair(a, b);

      nowMs = ist(23) + 1;
      await a.request('session:next', { sessionId: 'an-older-session' });

      await b.sync();
      expect(b.unreadCount('session:ended')).toBe(0);
      expect(server.app.matchmaker.getPartner(a.id, current)).toBe(b.id);
    });

    it('reports the new status to browsers that connect after closing', async () => {
      let nowMs = ist(22);
      server = await startTestServer({ openWindows }, { now: () => nowMs });
      await server.connect();
      nowMs = ist(23);
      const late = await server.connect();
      expect(late.status).toMatchObject<Partial<StatusPayload>>({ open: false, online: 2 });
    });
  });

  describe('cross-site access (CORS)', () => {
    const handshake = (origin: string) =>
      fetch(`${server.url}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: origin } });

    it('allows the configured web app address', async () => {
      server = await startTestServer({ corsOrigins: ['https://bitsomeggle.example'] });
      const response = await handshake('https://bitsomeggle.example');
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'https://bitsomeggle.example',
      );
    });

    it('gives no permission to any other website', async () => {
      server = await startTestServer({ corsOrigins: ['https://bitsomeggle.example'] });
      const response = await handshake('https://evil.example');
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});
