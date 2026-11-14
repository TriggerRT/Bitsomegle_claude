import type { AckResult, IceServer } from '@bitsomeggle/shared';
import { describe, expect, it } from 'vitest';
import { ChatController } from './chatController.ts';
import type { PeerOptions, Signal } from './peer.ts';
import type { ChatSocket } from './socket.ts';

// ---------------------------------------------------------------------------
// Fakes: stand-ins for the network, the camera and the video call, so the controller
// can be tested without a browser.
// ---------------------------------------------------------------------------

class FakeSocket {
  connected = false;
  /** Everything the controller sent to the "server", in order. */
  readonly sent: Array<{ event: string; payload: unknown }> = [];
  /** What the "server" answers to each request. Unlisted requests get `{ ok: true }`. */
  readonly replies = new Map<string, AckResult | 'no reply'>();
  private readonly handlers = new Map<string, (...args: unknown[]) => void>();

  on(event: string, handler: (...args: unknown[]) => void): this {
    this.handlers.set(event, handler);
    return this;
  }

  emit(event: string, payload?: unknown): this {
    this.sent.push({ event, payload: typeof payload === 'function' ? undefined : payload });
    return this;
  }

  timeout(): { emitWithAck: (event: string, payload?: unknown) => Promise<AckResult> } {
    return {
      emitWithAck: (event, payload) => {
        this.sent.push({ event, payload });
        const reply = this.replies.get(event) ?? { ok: true };
        return reply === 'no reply' ? Promise.reject(new Error('timeout')) : Promise.resolve(reply);
      },
    };
  }

  connect(): this {
    this.connected = true;
    this.receive('connect');
    return this;
  }

  disconnect(): this {
    this.connected = false;
    return this;
  }

  removeAllListeners(): this {
    this.handlers.clear();
    return this;
  }

  /** Pretends the server sent an event. */
  receive(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.(...args);
  }

  sentEvents(event: string): unknown[] {
    return this.sent.filter((entry) => entry.event === event).map((entry) => entry.payload);
  }
}

class FakeTrack {
  enabled = true;
  stopped = false;
  readonly kind: 'audio' | 'video';

  constructor(kind: 'audio' | 'video') {
    this.kind = kind;
  }

  stop(): void {
    this.stopped = true;
  }
}

class FakeStream {
  readonly tracks: FakeTrack[];

  constructor(...kinds: Array<'audio' | 'video'>) {
    this.tracks = kinds.map((kind) => new FakeTrack(kind));
  }

  getTracks = (): FakeTrack[] => this.tracks;
  getAudioTracks = (): FakeTrack[] => this.tracks.filter((track) => track.kind === 'audio');
  getVideoTracks = (): FakeTrack[] => this.tracks.filter((track) => track.kind === 'video');
  get audio(): FakeTrack | undefined {
    return this.getAudioTracks()[0];
  }
  get video(): FakeTrack | undefined {
    return this.getVideoTracks()[0];
  }
  get allStopped(): boolean {
    return this.tracks.every((track) => track.stopped);
  }
}

interface FakePeer {
  options: PeerOptions;
  received: Signal[];
  closed: boolean;
}

const ICE: IceServer[] = [{ urls: 'stun:stun.example.org' }];
const OFFER = { type: 'offer' as const, sdp: 'v=0' };

/** Lets promise callbacks (camera granted, server replied) run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const socket = new FakeSocket();
  const peers: FakePeer[] = [];
  const errors: string[] = [];
  /** Each call to acquireMedia waits here until the test grants or denies it. */
  const mediaRequests: Array<{
    grant: (stream: FakeStream) => void;
    deny: (reason: string) => void;
  }> = [];
  let idCounter = 0;

  const controller = new ChatController({
    socket: socket as unknown as ChatSocket,
    acquireMedia: () =>
      new Promise<MediaStream>((resolve, reject) => {
        mediaRequests.push({
          grant: (stream) => resolve(stream as unknown as MediaStream),
          deny: (reason) => reject(Object.assign(new Error(reason), { reason })),
        });
      }),
    stopMedia: (stream) => {
      for (const track of stream.getTracks()) track.stop();
    },
    createPeer: (options) => {
      const peer: FakePeer = { options, received: [], closed: false };
      peers.push(peer);
      return {
        handleSignal: (signal) => peer.received.push(signal),
        close: () => {
          peer.closed = true;
        },
      };
    },
    newId: () => {
      idCounter += 1;
      return `id${idCounter}`;
    },
    reportError: (message) => errors.push(message),
  });
  controller.connect();

  const state = () => controller.getSnapshot().state;

  /** Press Start and allow camera + microphone. Returns the stream that was handed over. */
  const startWithCamera = async (stream = new FakeStream('audio', 'video')) => {
    controller.start();
    mediaRequests.at(-1)?.grant(stream);
    await settle();
    return stream;
  };

  const match = (sessionId: string, polite = false) =>
    socket.receive('session:matched', { sessionId, polite, iceServers: ICE });

  return { controller, socket, peers, errors, mediaRequests, state, startWithCamera, match };
}

// ---------------------------------------------------------------------------

describe('ChatController', () => {
  describe('starting', () => {
    it('asks for the camera first and joins the queue only once it is allowed', async () => {
      const { controller, socket, mediaRequests, state } = setup();

      controller.start();
      expect(state().phase).toBe('requesting_media');
      expect(mediaRequests).toHaveLength(1);
      expect(socket.sentEvents('queue:join')).toHaveLength(0);

      const stream = new FakeStream('audio', 'video');
      mediaRequests[0]?.grant(stream);
      await settle();

      expect(state().phase).toBe('waiting');
      expect(socket.sentEvents('queue:join')).toHaveLength(1);
      expect(controller.getSnapshot().localStream).toBe(stream);
    });

    it('pressing Start twice asks for the camera only once', () => {
      const { controller, mediaRequests } = setup();
      controller.start();
      controller.start();
      expect(mediaRequests).toHaveLength(1);
    });

    it('does nothing while not connected to the server', () => {
      const { controller, socket, mediaRequests, state } = setup();
      socket.receive('disconnect', 'transport close');
      controller.start();
      expect(mediaRequests).toHaveLength(0);
      expect(state().phase).toBe('idle');
    });

    it('shows why when the camera is refused, and never joins the queue', async () => {
      const { controller, socket, mediaRequests, state, errors } = setup();
      controller.start();
      mediaRequests[0]?.deny('denied');
      await settle();

      expect(state()).toMatchObject({ phase: 'media_error', mediaError: 'denied' });
      expect(socket.sentEvents('queue:join')).toHaveLength(0);
      expect(errors).toEqual([]); // an expected refusal is not a programming error
    });

    it('reports an unrecognised camera failure as "unknown" and logs it', async () => {
      const { controller, mediaRequests, state, errors } = setup();
      controller.start();
      mediaRequests[0]?.deny('something-new');
      await settle();

      expect(state().mediaError).toBe('unknown');
      expect(errors).toEqual(['Unexpected camera error']);
    });

    it('"Try again" after a refusal asks for the camera again', async () => {
      const { controller, mediaRequests, state } = setup();
      controller.start();
      mediaRequests[0]?.deny('denied');
      await settle();

      controller.start();
      mediaRequests[1]?.grant(new FakeStream('audio', 'video'));
      await settle();
      expect(state().phase).toBe('waiting');
    });

    it('cancelling during the permission prompt switches the camera straight off', async () => {
      const { controller, socket, mediaRequests, state } = setup();
      controller.start();
      controller.leave(); // user changed their mind while the prompt was open

      const stream = new FakeStream('audio', 'video');
      mediaRequests[0]?.grant(stream); // then clicked "Allow" anyway
      await settle();

      expect(stream.allStopped).toBe(true);
      expect(state().phase).toBe('idle');
      expect(controller.getSnapshot().localStream).toBeNull();
      expect(socket.sentEvents('queue:join')).toHaveLength(0);
    });

    it('a device with no camera joins with audio only', async () => {
      const { socket, state, startWithCamera, match } = setup();
      await startWithCamera(new FakeStream('audio'));

      expect(state()).toMatchObject({ phase: 'waiting', hasCamera: false });
      match('s1');
      expect(socket.sentEvents('media:state')).toEqual([
        { sessionId: 's1', audio: true, video: false },
      ]);
    });
  });

  describe('the video call', () => {
    it('opens one call per match, with the role and servers the server gave', async () => {
      const { peers, startWithCamera, match } = setup();
      const stream = await startWithCamera();
      match('s1', true);

      expect(peers).toHaveLength(1);
      expect(peers[0]?.options).toMatchObject({ polite: true, iceServers: ICE });
      expect(peers[0]?.options.localStream).toBe(stream);
    });

    it('sends our call-setup messages to the server with the session id', async () => {
      const { socket, peers, startWithCamera, match } = setup();
      await startWithCamera();
      match('s1');

      peers[0]?.options.sendSignal({ description: OFFER });

      expect(socket.sentEvents('signal')).toEqual([{ sessionId: 's1', description: OFFER }]);
    });

    it('passes call-setup messages from the partner to the call', async () => {
      const { socket, peers, startWithCamera, match } = setup();
      await startWithCamera();
      match('s1');

      socket.receive('signal', { sessionId: 's1', description: OFFER });
      socket.receive('signal', { sessionId: 's1', candidate: { candidate: 'candidate:1' } });

      expect(peers[0]?.received).toEqual([
        { description: OFFER },
        { candidate: { candidate: 'candidate:1' } },
      ]);
    });

    it('never passes a message from a previous partner to the current call', async () => {
      const { controller, socket, peers, startWithCamera, match } = setup();
      await startWithCamera();
      match('s1');
      controller.next();
      match('s2');

      socket.receive('signal', { sessionId: 's1', description: OFFER });

      expect(peers[1]?.received).toEqual([]);
    });

    it("shows the partner's video when it arrives", async () => {
      const { controller, peers, startWithCamera, match } = setup();
      await startWithCamera();
      match('s1');
      const remote = new FakeStream('audio', 'video') as unknown as MediaStream;

      peers[0]?.options.onRemoteStream(remote);

      expect(controller.getSnapshot().remoteStream).toBe(remote);
    });

    it('tracks whether the call is connected', async () => {
      const { peers, state, startWithCamera, match } = setup();
      await startWithCamera();
      match('s1');
      expect(state().call).toBe('connecting');

      peers[0]?.options.onCallState('connected');
      expect(state().call).toBe('connected');
    });

    it('logs an unexpected call-setup failure', async () => {
      const { peers, errors, startWithCamera, match } = setup();
      await startWithCamera();
      match('s1');
      peers[0]?.options.onError(new Error('boom'));
      expect(errors).toEqual(['Video call setup failed']);
    });
  });

  describe('Next', () => {
    it('closes the call, keeps the camera on, and names the session to the server', async () => {
      const { controller, socket, peers, state, startWithCamera, match } = setup();
      const stream = await startWithCamera();
      match('s1');

      controller.next();

      expect(peers[0]?.closed).toBe(true);
      expect(stream.allStopped).toBe(false);
      expect(controller.getSnapshot().localStream).toBe(stream);
      expect(controller.getSnapshot().remoteStream).toBeNull();
      expect(state().phase).toBe('waiting');
      expect(socket.sentEvents('session:next')).toEqual([{ sessionId: 's1' }]);
    });

    it('opens a fresh call for the new partner and reuses the same camera', async () => {
      const { controller, peers, startWithCamera, match } = setup();
      const stream = await startWithCamera();
      match('s1');
      controller.next();
      match('s2', true);

      expect(peers).toHaveLength(2);
      expect(peers[1]?.closed).toBe(false);
      expect(peers[1]?.options.localStream).toBe(stream);
    });

    it('ignores anything the old call reports after it was closed', async () => {
      const { controller, peers, state, startWithCamera, match } = setup();
      await startWithCamera();
      match('s1');
      controller.next();
      match('s2');
      const oldVideo = new FakeStream('video') as unknown as MediaStream;

      peers[0]?.options.onRemoteStream(oldVideo);
      peers[0]?.options.onCallState('failed');

      expect(controller.getSnapshot().remoteStream).toBeNull();
      expect(state().call).toBe('connecting');
    });

    it('after the partner left, Next simply rejoins the queue', async () => {
      const { controller, socket, peers, state, startWithCamera, match } = setup();
      const stream = await startWithCamera();
      match('s1');
      socket.receive('session:ended', { sessionId: 's1', reason: 'partner_next' });

      expect(peers[0]?.closed).toBe(true);
      expect(stream.allStopped).toBe(false); // still previewing ourselves
      expect(state().phase).toBe('partner_left');

      controller.next();
      expect(socket.sentEvents('queue:join')).toHaveLength(2);
      expect(socket.sentEvents('session:next')).toHaveLength(0);
    });

    it('if the server refuses, returns to the start, releases the camera and tells the server to drop us', async () => {
      const { controller, socket, peers, state, startWithCamera, match } = setup();
      const stream = await startWithCamera();
      match('s1');
      socket.replies.set('session:next', { ok: false, code: 'rate_limited' });

      controller.next();
      await settle();

      expect(state()).toMatchObject({ phase: 'idle', notice: 'rate_limited' });
      expect(peers[0]?.closed).toBe(true);
      expect(stream.allStopped).toBe(true);
      expect(socket.sentEvents('leave')).toHaveLength(1);
    });

    it('if the server does not answer, treats it the same way', async () => {
      const { controller, socket, state, startWithCamera, match } = setup();
      await startWithCamera();
      match('s1');
      socket.replies.set('session:next', 'no reply');

      controller.next();
      await settle();

      expect(state()).toMatchObject({ phase: 'idle', notice: 'timeout' });
      expect(socket.sentEvents('leave')).toHaveLength(1);
    });
  });

  describe('Leave', () => {
    it('closes the call, switches the camera off and tells the server', async () => {
      const { controller, socket, peers, state, startWithCamera, match } = setup();
      const stream = await startWithCamera();
      match('s1');

      controller.leave();

      expect(peers[0]?.closed).toBe(true);
      expect(stream.allStopped).toBe(true);
      expect(controller.getSnapshot()).toMatchObject({ localStream: null, remoteStream: null });
      expect(state().phase).toBe('idle');
      expect(socket.sentEvents('leave')).toHaveLength(1);
    });

    it('a match that arrives just after Leave opens no call and no camera', async () => {
      const { controller, peers, state, startWithCamera, match } = setup();
      const stream = await startWithCamera();
      controller.leave();

      match('s1');

      expect(peers).toHaveLength(0);
      expect(stream.allStopped).toBe(true);
      expect(state().phase).toBe('idle');
    });
  });

  describe('mic and camera buttons', () => {
    it('switch the tracks off and on without releasing the devices', async () => {
      const { controller, startWithCamera } = setup();
      const stream = await startWithCamera();

      controller.toggleMic();
      expect(stream.audio?.enabled).toBe(false);
      expect(stream.video?.enabled).toBe(true);

      controller.toggleCamera();
      expect(stream.video?.enabled).toBe(false);

      controller.toggleMic();
      expect(stream.audio?.enabled).toBe(true);
      expect(stream.allStopped).toBe(false);
    });

    it('tell the partner about each change, once', async () => {
      const { controller, socket, startWithCamera, match } = setup();
      await startWithCamera();
      match('s1');
      controller.toggleCamera();
      controller.dismissNotice(); // an unrelated event must not resend anything

      expect(socket.sentEvents('media:state')).toEqual([
        { sessionId: 's1', audio: true, video: true },
        { sessionId: 's1', audio: true, video: false },
      ]);
    });

    it('a choice made while waiting applies to the next partner from the start', async () => {
      const { controller, socket, startWithCamera, match } = setup();
      const stream = await startWithCamera();
      controller.toggleMic();
      match('s1');

      expect(stream.audio?.enabled).toBe(false);
      expect(socket.sentEvents('media:state')).toEqual([
        { sessionId: 's1', audio: false, video: true },
      ]);
    });

    it("shows the partner's reported state", async () => {
      const { socket, state, startWithCamera, match } = setup();
      await startWithCamera();
      match('s1');
      socket.receive('media:state', { sessionId: 's1', audio: false, video: true });
      expect(state().partnerMedia).toEqual({ audio: false, video: true });
    });
  });

  describe('text messages', () => {
    it('are sent with the session id and marked delivered', async () => {
      const { controller, socket, state, startWithCamera, match } = setup();
      await startWithCamera();
      match('s1');

      controller.sendMessage('  hello  ');
      await settle();

      expect(socket.sentEvents('chat:send')).toEqual([{ sessionId: 's1', text: 'hello' }]);
      expect(state().messages).toMatchObject([{ from: 'me', text: 'hello', delivery: 'sent' }]);
    });

    it('are marked failed when the server refuses them', async () => {
      const { controller, socket, state, startWithCamera, match } = setup();
      await startWithCamera();
      match('s1');
      socket.replies.set('chat:send', { ok: false, code: 'not_in_session' });

      controller.sendMessage('hello');
      await settle();

      expect(state().messages[0]?.delivery).toBe('failed');
    });

    it('are not sent when empty or when not in a chat', async () => {
      const { controller, socket, startWithCamera, match } = setup();
      controller.sendMessage('too early');
      await startWithCamera();
      match('s1');
      controller.sendMessage('    ');
      expect(socket.sentEvents('chat:send')).toHaveLength(0);
    });

    it('received from the partner appear in the conversation', async () => {
      const { socket, state, startWithCamera, match } = setup();
      await startWithCamera();
      match('s1');
      socket.receive('chat:message', { sessionId: 's1', text: 'hi', at: 1 });
      expect(state().messages).toMatchObject([{ from: 'stranger', text: 'hi' }]);
    });
  });

  describe('connection problems', () => {
    it('losing the connection ends the call and releases the camera', async () => {
      const { controller, socket, peers, state, startWithCamera, match } = setup();
      const stream = await startWithCamera();
      match('s1');

      socket.receive('disconnect', 'transport close');

      expect(peers[0]?.closed).toBe(true);
      expect(stream.allStopped).toBe(true);
      expect(state()).toMatchObject({ phase: 'idle', notice: 'connection_lost' });
      expect(controller.getSnapshot().remoteStream).toBeNull();
    });

    it('reconnects by itself after being disconnected by the server', () => {
      const { socket, state } = setup();
      socket.receive('disconnect', 'io server disconnect');
      // FakeSocket.connect() reports "connected" straight away.
      expect(state().connection).toBe('connected');
    });

    it('reports a full server', () => {
      const { socket, state } = setup();
      socket.receive('connect_error', new Error('server_full'));
      expect(state().connection).toBe('full');
    });
  });

  describe('subscribers and shutdown', () => {
    it('are told about every change with a fresh snapshot', async () => {
      const { controller, startWithCamera } = setup();
      const seen: string[] = [];
      controller.subscribe(() => seen.push(controller.getSnapshot().state.phase));

      await startWithCamera();

      expect(seen).toEqual(['requesting_media', 'waiting']);
    });

    it('destroy closes the call, switches the camera off and disconnects', async () => {
      const { controller, socket, peers, startWithCamera, match } = setup();
      const stream = await startWithCamera();
      match('s1');

      controller.destroy();

      expect(peers[0]?.closed).toBe(true);
      expect(stream.allStopped).toBe(true);
      expect(socket.connected).toBe(false);
    });

    it('a camera granted after destroy is switched straight off', async () => {
      const { controller, mediaRequests } = setup();
      controller.start();
      controller.destroy();

      const stream = new FakeStream('audio', 'video');
      mediaRequests[0]?.grant(stream);
      await settle();

      expect(stream.allStopped).toBe(true);
    });
  });
});
