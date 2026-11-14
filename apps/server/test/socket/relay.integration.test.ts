import type {
  ChatMessagePayload,
  MatchedPayload,
  MediaStatePayload,
  SignalPayload,
} from '@bitsomeggle/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pair, startTestServer, type TestClient, type TestServer } from './helpers.ts';

describe('relaying messages between partners', () => {
  let server: TestServer;
  const fixedNow = 1_800_000_000_000;

  beforeEach(async () => {
    server = await startTestServer({}, { now: () => fixedNow });
  });

  afterEach(async () => {
    await server.stop();
  });

  /** After syncing, none of these clients may have received any of these events. */
  const expectNothingReceived = async (clients: TestClient[], events: string[]): Promise<void> => {
    await Promise.all(clients.map((client) => client.sync()));
    for (const client of clients) {
      for (const event of events) expect(client.unreadCount(event)).toBe(0);
    }
  };

  describe('text chat', () => {
    it('delivers a message to the partner only', async () => {
      const a = await server.connect();
      const b = await server.connect();
      const sessionId = await pair(a, b);

      expect(await a.request('chat:send', { sessionId, text: '  hello there  ' })).toEqual({
        ok: true,
      });

      expect(await b.next<ChatMessagePayload>('chat:message')).toEqual({
        sessionId,
        text: 'hello there',
        at: fixedNow,
      });
      await expectNothingReceived([a], ['chat:message']); // no echo back to the sender
    });

    it('does not leak messages into another session', async () => {
      const [a, b, c, d, waiting, idle] = await Promise.all(
        Array.from({ length: 6 }, () => server.connect()),
      );
      if (!a || !b || !c || !d || !waiting || !idle) throw new Error('setup failed');
      const first = await pair(a, b);
      const second = await pair(c, d);
      await waiting.request('queue:join');

      await a.request('chat:send', { sessionId: first, text: 'for b only' });
      await d.request('chat:send', { sessionId: second, text: 'for c only' });

      expect((await b.next<ChatMessagePayload>('chat:message')).text).toBe('for b only');
      expect((await c.next<ChatMessagePayload>('chat:message')).text).toBe('for c only');
      await expectNothingReceived([a, b, c, d, waiting, idle], ['chat:message']);
    });

    it('refuses a message that names a session the sender has left', async () => {
      const a = await server.connect();
      const b = await server.connect();
      const c = await server.connect();
      const first = await pair(a, b);
      await c.request('queue:join');

      await a.request('session:next', { sessionId: first }); // a is now with c
      await a.next<MatchedPayload>('session:matched');

      expect(await a.request('chat:send', { sessionId: first, text: 'late message' })).toEqual({
        ok: false,
        code: 'not_in_session',
      });
      await expectNothingReceived([b, c], ['chat:message']);
    });

    it("refuses a message sent into someone else's session", async () => {
      const a = await server.connect();
      const b = await server.connect();
      const outsider = await server.connect();
      const sessionId = await pair(a, b);

      expect(await outsider.request('chat:send', { sessionId, text: 'let me in' })).toEqual({
        ok: false,
        code: 'not_in_session',
      });
      await expectNothingReceived([a, b], ['chat:message']);
    });

    it('refuses a message from someone who is only waiting', async () => {
      const a = await server.connect();
      await a.request('queue:join');
      expect(await a.request('chat:send', { sessionId: 'anything', text: 'hello?' })).toEqual({
        ok: false,
        code: 'not_in_session',
      });
    });

    it('delivers messages in the order they were sent', async () => {
      const a = await server.connect();
      const b = await server.connect();
      const sessionId = await pair(a, b);

      for (const text of ['one', 'two', 'three']) a.send('chat:send', { sessionId, text });
      await a.sync();

      const received = [
        await b.next<ChatMessagePayload>('chat:message'),
        await b.next<ChatMessagePayload>('chat:message'),
        await b.next<ChatMessagePayload>('chat:message'),
      ].map((message) => message.text);
      expect(received).toEqual(['one', 'two', 'three']);
    });
  });

  describe('call setup (signal)', () => {
    const offer = { type: 'offer', sdp: 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\n' };
    const candidate = {
      candidate: 'candidate:1 1 udp 2122260223 192.0.2.1 54321 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    };

    it('passes a session description to the partner unchanged', async () => {
      const a = await server.connect();
      const b = await server.connect();
      const sessionId = await pair(a, b);

      a.send('signal', { sessionId, description: offer });

      expect(await b.next<SignalPayload>('signal')).toEqual({ sessionId, description: offer });
    });

    it('passes ICE candidates to the partner', async () => {
      const a = await server.connect();
      const b = await server.connect();
      const sessionId = await pair(a, b);

      b.send('signal', { sessionId, candidate });

      expect(await a.next<SignalPayload>('signal')).toEqual({ sessionId, candidate });
    });

    it('removes fields that are not part of the contract', async () => {
      const a = await server.connect();
      const b = await server.connect();
      const sessionId = await pair(a, b);

      a.send('signal', { sessionId, description: offer, to: b.id, extra: { anything: 1 } });

      expect(await b.next<SignalPayload>('signal')).toEqual({ sessionId, description: offer });
    });

    it('quietly drops call setup messages from a session that has ended', async () => {
      const a = await server.connect();
      const b = await server.connect();
      const c = await server.connect();
      const first = await pair(a, b);
      await c.request('queue:join');
      await a.request('session:next', { sessionId: first }); // a is now with c

      // A late candidate from the old call arrives after a has moved on.
      a.send('signal', { sessionId: first, candidate });
      b.send('signal', { sessionId: first, candidate });

      await expectNothingReceived([a, b, c], ['signal', 'server:error']);
    });

    it("does not relay into someone else's session", async () => {
      const a = await server.connect();
      const b = await server.connect();
      const outsider = await server.connect();
      const sessionId = await pair(a, b);

      outsider.send('signal', { sessionId, description: offer });

      await expectNothingReceived([a, b, outsider], ['signal']);
    });
  });

  describe('camera and microphone state', () => {
    it('tells the partner when the camera is turned off', async () => {
      const a = await server.connect();
      const b = await server.connect();
      const sessionId = await pair(a, b);

      a.send('media:state', { sessionId, audio: true, video: false });

      expect(await b.next<MediaStatePayload>('media:state')).toEqual({
        sessionId,
        audio: true,
        video: false,
      });
    });

    it('drops a state update for a session that has ended', async () => {
      const a = await server.connect();
      const b = await server.connect();
      const sessionId = await pair(a, b);
      await a.request('leave');
      await b.next('session:ended');

      a.send('media:state', { sessionId, audio: false, video: false });

      await expectNothingReceived([a, b], ['media:state', 'server:error']);
    });
  });
});
