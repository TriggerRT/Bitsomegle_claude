import type { AckResult } from '@bitsomeggle/shared';
import {
  type ChatEvent,
  type ChatState,
  chatReducer,
  initialChatState,
  type MediaErrorReason,
  type Notice,
} from '../state/chatMachine.ts';
import { type PeerLink, type PeerOptions, toSignal } from './peer.ts';
import { type ChatSocket, REQUEST_TIMEOUT_MS } from './socket.ts';

/** Everything the screen needs to draw itself. A new object is published on every change. */
export interface ChatSnapshot {
  state: ChatState;
  /** Our own camera and microphone, for the self-preview. */
  localStream: MediaStream | null;
  /** The partner's audio and video. */
  remoteStream: MediaStream | null;
}

export const INITIAL_SNAPSHOT: ChatSnapshot = {
  state: initialChatState,
  localStream: null,
  remoteStream: null,
};

/**
 * The outside world, passed in so that tests can replace each part with a fake
 * (a pretend socket, a pretend camera, a pretend call).
 */
export interface ChatControllerDeps {
  socket: ChatSocket;
  /** Asks for camera and microphone. Rejects with an error that has a `reason`. */
  acquireMedia: () => Promise<MediaStream>;
  stopMedia: (stream: MediaStream) => void;
  createPeer: (options: PeerOptions) => PeerLink;
  /** Makes a unique id for a chat message. */
  newId: () => string;
  /** Where unexpected problems are reported (the browser console in the real app). */
  reportError: (message: string, error: unknown) => void;
}

const noReplyNeeded = (): void => {};

function isMediaErrorReason(value: unknown): value is MediaErrorReason {
  return ['denied', 'no_device', 'in_use', 'insecure', 'unknown'].includes(value as string);
}

/**
 * Keeps the three moving parts of a chat in step: the server connection, the camera and
 * microphone, and the video call.
 *
 * How it works:
 * 1. Everything that happens (a button press, a server event, the camera being allowed)
 *    becomes an event for the state machine in state/chatMachine.ts. The state machine
 *    alone decides what the new state is.
 * 2. Straight after every event, `reconcile()` makes the real world match that state:
 *    it opens or closes the video call and switches the camera on or off.
 *
 * So there is no separate "when X happens, also remember to do Y" logic scattered around.
 * Whatever the state says should exist is created, and anything else is torn down.
 *
 * This is a plain class with no React in it, so it can be unit-tested, and it reacts to
 * each event immediately. That matters because the first call-setup message from the
 * partner can arrive a few milliseconds after "you are matched".
 */
export class ChatController {
  private readonly deps: ChatControllerDeps;
  private state: ChatState = initialChatState;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  /** The video call for the current session, if there is one. */
  private peer: { sessionId: string; link: PeerLink } | null = null;
  /** Increased whenever a pending camera request should be abandoned. */
  private mediaAttempt = 0;
  /** The last mic/camera state we told the partner, to avoid repeating ourselves. */
  private lastSentMediaState = '';
  private snapshot: ChatSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private destroyed = false;

  constructor(deps: ChatControllerDeps) {
    this.deps = deps;
  }

  // ------------------------------------------------------------------ for React

  getSnapshot = (): ChatSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // ------------------------------------------------------------------ lifecycle

  /** Starts listening to the server and connects. */
  connect(): void {
    const { socket } = this.deps;

    socket.on('connect', () => this.dispatch({ type: 'connected' }));
    socket.on('disconnect', (reason) => {
      this.dispatch({ type: 'connection_lost' });
      // After being disconnected BY the server, Socket.IO does not retry on its own.
      if (reason === 'io server disconnect' && !this.destroyed) socket.connect();
    });
    socket.on('connect_error', (error) => {
      if (error.message === 'server_full') this.dispatch({ type: 'server_full' });
    });

    socket.on('status', (status) => this.dispatch({ type: 'status', status }));
    socket.on('queue:waiting', () => this.dispatch({ type: 'waiting' }));
    socket.on('session:matched', (payload) => this.dispatch({ type: 'matched', ...payload }));
    socket.on('session:ended', (payload) => this.dispatch({ type: 'session_ended', ...payload }));
    socket.on('chat:message', ({ sessionId, text }) =>
      this.dispatch({ type: 'message_received', id: this.deps.newId(), sessionId, text }),
    );
    socket.on('media:state', (payload) => this.dispatch({ type: 'partner_media', ...payload }));
    socket.on('signal', (payload) => {
      // Call-setup messages go straight to the call they belong to. A late one from a
      // previous partner must never reach the current call.
      if (this.peer?.sessionId === payload.sessionId)
        this.peer.link.handleSignal(toSignal(payload));
    });

    socket.connect();
  }

  /** Disconnects and releases the camera. The controller cannot be used afterwards. */
  destroy(): void {
    this.destroyed = true;
    this.deps.socket.removeAllListeners();
    this.deps.socket.disconnect();
    this.closePeer();
    this.releaseMedia();
    this.listeners.clear();
  }

  // ------------------------------------------------------------------ user actions

  /** Start (or "Try again" after a camera problem): ask for the camera, then find a partner. */
  start(): void {
    const before = this.state;
    this.dispatch({ type: 'start_requested' });
    // The state machine ignores Start when it makes no sense (already started, offline).
    if (this.state === before || this.state.phase !== 'requesting_media') return;

    const attempt = ++this.mediaAttempt;
    this.deps.acquireMedia().then(
      (stream) => {
        // The user may have cancelled while the browser's permission prompt was open.
        if (attempt !== this.mediaAttempt || this.destroyed) {
          this.deps.stopMedia(stream);
          return;
        }
        this.localStream = stream;
        this.dispatch({ type: 'media_ready', hasCamera: stream.getVideoTracks().length > 0 });
        this.requestMatch((socket) => socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck('queue:join'));
      },
      (error: unknown) => {
        if (attempt !== this.mediaAttempt || this.destroyed) return;
        const reason = (error as { reason?: unknown } | null)?.reason;
        if (!isMediaErrorReason(reason)) this.deps.reportError('Unexpected camera error', error);
        this.dispatch({
          type: 'media_failed',
          reason: isMediaErrorReason(reason) ? reason : 'unknown',
        });
      },
    );
  }

  next(): void {
    const { phase, sessionId } = this.state;
    if (phase !== 'in_session' && phase !== 'partner_left') return;
    this.dispatch({ type: 'next_requested' });
    this.requestMatch((socket) =>
      // While in a chat, Next names that chat, so the server can ignore a duplicate
      // press that arrives after we have already been given a new partner.
      // After the partner left there is no chat to end; just look for someone new.
      sessionId !== null
        ? socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck('session:next', { sessionId })
        : socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck('queue:join'),
    );
  }

  /** Leave, Cancel, or "Back" from the camera problem screen. */
  leave(): void {
    this.dispatch({ type: 'leave_requested' });
    this.deps.socket.emit('leave', noReplyNeeded);
  }

  sendMessage(rawText: string): void {
    const { socket } = this.deps;
    const { phase, sessionId } = this.state;
    const text = rawText.trim();
    if (!socket.connected || phase !== 'in_session' || sessionId === null || text === '') return;

    const id = this.deps.newId();
    this.dispatch({ type: 'message_sent', id, text });
    socket
      .timeout(REQUEST_TIMEOUT_MS)
      .emitWithAck('chat:send', { sessionId, text })
      .then(
        (reply) => this.dispatch({ type: reply.ok ? 'message_delivered' : 'message_failed', id }),
        () => this.dispatch({ type: 'message_failed', id }),
      );
  }

  toggleMic(): void {
    this.dispatch({ type: 'mic_toggled' });
  }

  toggleCamera(): void {
    this.dispatch({ type: 'camera_toggled' });
  }

  dismissNotice(): void {
    this.dispatch({ type: 'notice_dismissed' });
  }

  /** Try to connect again after the server reported it was full. */
  retryConnection(): void {
    this.deps.socket.connect();
  }

  // ------------------------------------------------------------------ internals

  private dispatch(event: ChatEvent): void {
    if (this.destroyed) return;
    this.state = chatReducer(this.state, event);
    this.reconcile();
    this.publish();
  }

  private publish(): void {
    this.snapshot = {
      state: this.state,
      localStream: this.localStream,
      remoteStream: this.remoteStream,
    };
    for (const listener of this.listeners) listener();
  }

  /** Makes the camera and the video call match what the state says should exist. */
  private reconcile(): void {
    const { phase, sessionId, localMedia } = this.state;

    // 1. Camera and microphone are held from Start until the user is back on the landing
    //    page (or stuck on the camera problem screen). They stay on between partners.
    const needsMedia = phase !== 'idle' && phase !== 'media_error';
    if (!needsMedia) this.releaseMedia();

    // 2. The mic and camera buttons switch the tracks off without releasing the devices,
    //    so switching back on is instant. A disabled camera sends black frames.
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) track.enabled = localMedia.audio;
      for (const track of this.localStream.getVideoTracks()) track.enabled = localMedia.video;
    }

    // 3. Exactly one video call per session: close the old one first, then open the new.
    const wantedSession = phase === 'in_session' ? sessionId : null;
    if (this.peer && this.peer.sessionId !== wantedSession) this.closePeer();
    if (wantedSession !== null && !this.peer && this.localStream) this.openPeer(wantedSession);

    // 4. Tell the partner whether our mic and camera are on (once per change).
    if (this.peer) {
      const key = `${this.peer.sessionId}:${localMedia.audio}:${localMedia.video}`;
      if (key !== this.lastSentMediaState) {
        this.lastSentMediaState = key;
        this.deps.socket.emit('media:state', { sessionId: this.peer.sessionId, ...localMedia });
      }
    }
  }

  private openPeer(sessionId: string): void {
    if (!this.localStream) return;
    const { socket } = this.deps;

    const link = this.deps.createPeer({
      polite: this.state.polite,
      iceServers: this.state.iceServers,
      localStream: this.localStream,
      sendSignal: (signal) => socket.emit('signal', { sessionId, ...signal }),
      onRemoteStream: (stream) => {
        if (this.peer?.sessionId !== sessionId) return;
        this.remoteStream = stream;
        this.publish();
      },
      onCallState: (call) => this.dispatch({ type: 'call_state', sessionId, call }),
      onError: (error) => this.deps.reportError('Video call setup failed', error),
    });
    this.peer = { sessionId, link };
  }

  private closePeer(): void {
    this.peer?.link.close();
    this.peer = null;
    this.remoteStream = null;
  }

  private releaseMedia(): void {
    this.mediaAttempt += 1; // abandons a permission prompt that is still open
    if (this.localStream) this.deps.stopMedia(this.localStream);
    this.localStream = null;
  }

  /**
   * Sends Start or Next and handles a "no". If the server refuses (closed, too fast) or
   * does not answer, we go back to the landing page AND tell the server to drop whatever
   * it has for us, so the two sides cannot disagree about whether we are in a chat.
   */
  private requestMatch(send: (socket: ChatSocket) => Promise<AckResult>): void {
    const { socket } = this.deps;
    if (!socket.connected) return;

    send(socket)
      .then(
        (reply): Notice | null => (reply.ok ? null : reply.code),
        // Socket.IO rejects the promise when no reply arrives within the timeout.
        (): Notice => 'timeout',
      )
      .then((refusal) => {
        if (refusal === null || this.destroyed) return;
        this.dispatch({ type: 'request_refused', reason: refusal });
        socket.emit('leave', noReplyNeeded);
      });
  }
}
