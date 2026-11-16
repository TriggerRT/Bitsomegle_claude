/**
 * What happens when a connection drops without a goodbye (Wi-Fi blip, phone changing
 * network) and comes back: a call is kept for a short "grace" period.
 */
import type { ChatMessagePayload, SessionEndedPayload, StatusPayload } from '@bitsomeggle/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pair, startTestServer, type TestServer } from './helpers.ts';

/** Short, so the tests are fast. Production uses 10 seconds. */
const GRACE_MS = 300;
const STATUS_INTERVAL_MS = 50;
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('reconnect grace', () => {
  let server: TestServer;

  afterEach(async () => {
    await server.stop();
  });

  const start = async (): Promise<void> => {
    server = await startTestServer(
      { reconnectGraceMs: GRACE_MS },
      { statusIntervalMs: STATUS_INTERVAL_MS },
    );
  };

  describe('someone in a call who comes straight back', () => {
    it('keeps the call: the partner notices nothing and messages flow again', async () => {
      await start();
      const a = await server.connect({}, { reconnects: true });
      const b = await server.connect();
      const sessionId = await pair(a, b);
      const idBefore = a.id;

      a.dropConnection();
      await a.waitUntilConnected();

      expect(a.socket.recovered).toBe(true);
      expect(a.id).toBe(idBefore);
      expect(await a.request('chat:send', { sessionId, text: 'back again' })).toEqual({ ok: true });
      expect(await b.next<ChatMessagePayload>('chat:message')).toMatchObject({
        text: 'back again',
      });
      expect(b.unreadCount('session:ended')).toBe(0);
      expect(server.app.matchmaker.stats()).toMatchObject({ clients: 2, sessions: 1 });
      server.app.matchmaker.assertInvariants();
    });

    it('still keeps the call after the grace period has long passed', async () => {
      await start();
      const a = await server.connect({}, { reconnects: true });
      const b = await server.connect();
      await pair(a, b);
      a.dropConnection();
      await a.waitUntilConnected();

      // If the "give up" timer had not been cancelled, it would end the call about now.
      await wait(GRACE_MS * 2);

      await b.sync();
      expect(b.unreadCount('session:ended')).toBe(0);
      expect(server.app.matchmaker.stats().sessions).toBe(1);
    });

    it('receives what the partner sent while it was away', async () => {
      await start();
      const a = await server.connect({}, { reconnects: true });
      const b = await server.connect();
      const sessionId = await pair(a, b);

      a.dropConnection({ stayAway: true });
      await expect.poll(() => server.app.io.of('/').sockets.size).toBe(1);
      expect(await b.request('chat:send', { sessionId, text: 'are you there?' })).toEqual({
        ok: true,
      });
      await a.comeBack();

      expect(await a.next<ChatMessagePayload>('chat:message')).toMatchObject({
        sessionId,
        text: 'are you there?',
      });
    });

    it('learns that the partner pressed Next while it was away', async () => {
      await start();
      const a = await server.connect({}, { reconnects: true });
      const b = await server.connect();
      const sessionId = await pair(a, b);

      a.dropConnection({ stayAway: true });
      await expect.poll(() => server.app.io.of('/').sockets.size).toBe(1);
      await b.request('session:next', { sessionId });
      await a.comeBack();

      expect(await a.next<SessionEndedPayload>('session:ended')).toEqual({
        sessionId,
        reason: 'partner_next',
      });
      expect(server.app.matchmaker.getClient(a.id)).toMatchObject({ state: 'idle' });
      server.app.matchmaker.assertInvariants();
    });

    it('can come back even when the server is full', async () => {
      server = await startTestServer(
        { reconnectGraceMs: GRACE_MS, maxClients: 2 },
        { statusIntervalMs: STATUS_INTERVAL_MS },
      );
      const a = await server.connect({}, { reconnects: true });
      const b = await server.connect();
      await pair(a, b);

      a.dropConnection({ stayAway: true });
      await expect.poll(() => server.app.io.of('/').sockets.size).toBe(1);
      const newcomer = await server.connect(); // takes the free place
      await a.comeBack();

      expect(a.socket.recovered).toBe(true);
      expect(newcomer.socket.connected).toBe(true);
    });
  });

  describe('someone in a call who does not come back in time', () => {
    it('the partner is told once the grace period is over, not before', async () => {
      await start();
      const a = await server.connect();
      const b = await server.connect();
      const sessionId = await pair(a, b);

      const droppedAt = Date.now();
      a.dropConnection();

      expect(await b.next<SessionEndedPayload>('session:ended')).toEqual({
        sessionId,
        reason: 'partner_disconnected',
      });
      // A little tolerance: timers may fire a few milliseconds early.
      expect(Date.now() - droppedAt).toBeGreaterThanOrEqual(GRACE_MS - 20);
      expect(server.app.matchmaker.stats()).toMatchObject({ clients: 1, sessions: 0 });
      server.app.matchmaker.assertInvariants();
    });

    it('is told its call is gone if it turns up later, and can start again', async () => {
      await start();
      const a = await server.connect();
      const b = await server.connect();
      await pair(a, b);
      a.dropConnection();
      await b.next('session:ended');

      // Socket.IO still remembers the old connection and restores it, so the browser
      // would believe nothing changed. The server has to say otherwise.
      await a.comeBack();

      expect(a.socket.recovered).toBe(true);
      await a.next('connection:reset');
      expect(server.app.matchmaker.getClient(a.id)).toMatchObject({ state: 'idle' });
      expect(await a.request('queue:join')).toEqual({ ok: true });
      await a.next('queue:waiting');
      server.app.matchmaker.assertInvariants();
    });

    it('is not told anything of the kind when it came back in time', async () => {
      await start();
      const a = await server.connect({}, { reconnects: true });
      const b = await server.connect();
      await pair(a, b);

      a.dropConnection();
      await a.waitUntilConnected();

      await a.sync();
      expect(a.unreadCount('connection:reset')).toBe(0);
    });
  });

  describe('cases that get no grace period', () => {
    it('someone waiting is removed at once, so nobody is matched with a ghost', async () => {
      await start();
      const a = await server.connect();
      await a.request('queue:join');
      await a.next('queue:waiting');

      a.dropConnection();
      // As soon as the server has noticed the drop (no waiting for a grace period)...
      await expect.poll(() => server.app.io.of('/').sockets.size).toBe(0);
      expect(server.app.matchmaker.stats()).toMatchObject({ clients: 0, waiting: 0 });

      // ...a newcomer must find the queue empty.
      const b = await server.connect();
      await b.request('queue:join');
      await b.next('queue:waiting');
      expect(b.unreadCount('session:matched')).toBe(0);
    });

    it('someone who was waiting and comes back is a new visitor, and is told so', async () => {
      await start();
      const a = await server.connect();
      await a.request('queue:join');
      a.dropConnection();
      await expect.poll(() => server.app.matchmaker.stats().clients).toBe(0);

      await a.comeBack();

      await a.next('connection:reset');
      expect(server.app.matchmaker.stats()).toMatchObject({ clients: 1, waiting: 0 });
    });

    it('a first-time visitor is never sent a reset', async () => {
      await start();
      const a = await server.connect();
      await a.sync();
      expect(a.unreadCount('connection:reset')).toBe(0);
    });

    it('closing the page on purpose ends the call immediately', async () => {
      await start();
      const a = await server.connect();
      const b = await server.connect();
      await pair(a, b);

      const closedAt = Date.now();
      a.close(); // a proper goodbye, unlike dropConnection()

      await b.next('session:ended');
      expect(Date.now() - closedAt).toBeLessThan(GRACE_MS);
    });

    it('an old copy of the web app, which would not know its call was kept', async () => {
      await start();
      const old = await server.connect({}, { protocol: null });
      const b = await server.connect();
      await pair(old, b);

      const droppedAt = Date.now();
      old.dropConnection();

      await b.next('session:ended');
      expect(Date.now() - droppedAt).toBeLessThan(GRACE_MS);
    });

    it('everyone, when the grace period is switched off', async () => {
      server = await startTestServer({ reconnectGraceMs: 0 });
      const a = await server.connect({}, { reconnects: true });
      const b = await server.connect();
      await pair(a, b);
      const oldId = a.id;

      a.dropConnection();
      await b.next('session:ended');
      await a.waitUntilConnected();

      expect(a.socket.recovered).not.toBe(true);
      expect(a.id).not.toBe(oldId);
    });
  });
});

describe('regular status message', () => {
  let server: TestServer;

  afterEach(async () => {
    await server.stop();
  });

  it('keeps the number of people online up to date', async () => {
    server = await startTestServer({}, { statusIntervalMs: STATUS_INTERVAL_MS });
    const a = await server.connect();
    expect(a.status.online).toBe(1);

    await server.connect();

    await expect
      .poll(async () => (await a.next<StatusPayload>('status')).online, { timeout: 2000 })
      .toBe(2);
  });

  it('stops when the server closes', async () => {
    server = await startTestServer({}, { statusIntervalMs: STATUS_INTERVAL_MS });
    const emit = vi.spyOn(server.app.io, 'emit');
    await server.connect();
    await expect.poll(() => emit.mock.calls.length).toBeGreaterThan(0);

    await server.stop();
    const sentAtStop = emit.mock.calls.length;
    await wait(STATUS_INTERVAL_MS * 4);

    expect(emit.mock.calls.length).toBe(sentAtStop);
  });
});
