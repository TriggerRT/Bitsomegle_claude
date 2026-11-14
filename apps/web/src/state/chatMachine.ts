/**
 * The web app's "state machine": the single place that decides what the user is doing
 * right now (idle, waiting, talking, partner left) and therefore which screen is shown.
 *
 * It is a "reducer": a function that takes the current state and one event, and returns
 * the next state. It never talks to the network, the camera, the clock or the screen,
 * which makes every transition easy to test (see chatMachine.test.ts).
 *
 * Events come from three places:
 * - the user (pressed Start, Next, Leave, a mic or camera button, sent a message),
 * - the server (you are waiting, you are matched, your session ended, a message arrived),
 * - the browser (camera permission granted or refused, the video call connected or failed).
 *
 * KEY RULE for staying in step with the server: an event from the server can be late.
 * For example, the user presses Leave a split second after the server matched them; the
 * "matched" event then arrives while the user is already back on the landing page.
 * So server events are only applied when they still make sense:
 * - `waiting` and `matched` only while the user is actually looking for or in a chat;
 * - everything about a session only if it names the current session.
 */
import type { ErrorCode, IceServer, SessionEndReason, StatusPayload } from '@bitsomeggle/shared';

/**
 * - connecting: first connection attempt in progress
 * - connected: ready
 * - reconnecting: the connection dropped and is being re-established
 * - full: the server refused us because it is at capacity
 */
export type Connection = 'connecting' | 'connected' | 'reconnecting' | 'full';

/**
 * - idle: on the landing page
 * - requesting_media: the browser is asking for camera and microphone permission
 * - media_error: camera or microphone could not be used
 * - waiting: looking for a partner
 * - in_session: talking to a partner
 * - partner_left: the partner ended the chat; the old conversation is still on screen
 */
export type Phase =
  | 'idle'
  | 'requesting_media'
  | 'media_error'
  | 'waiting'
  | 'in_session'
  | 'partner_left';

/** Something to tell the user on the landing page after being sent back there. */
export type Notice = ErrorCode | 'timeout' | 'connection_lost';

/**
 * Why the camera or microphone could not be used.
 * - denied: the user (or a browser setting) refused permission
 * - no_device: no microphone was found
 * - in_use: another app is using the device
 * - insecure: the page is not on https or localhost, so browsers block camera access
 * - unknown: anything else
 */
export type MediaErrorReason = 'denied' | 'no_device' | 'in_use' | 'insecure' | 'unknown';

/**
 * State of the direct audio/video connection to the partner.
 * - connecting: being set up, or briefly interrupted
 * - connected: audio and video are flowing
 * - failed: no path between the two browsers could be found
 */
export type CallState = 'connecting' | 'connected' | 'failed';

/** Whether a microphone and camera are switched on. */
export interface MediaFlags {
  audio: boolean;
  video: boolean;
}

export interface ChatMessage {
  id: string;
  from: 'me' | 'stranger';
  text: string;
  /** For my own messages: whether the server accepted it. Always 'sent' for the stranger's. */
  delivery: 'sending' | 'sent' | 'failed';
}

export interface ChatState {
  connection: Connection;
  /** Opening hours and online count, as last reported by the server. */
  status: StatusPayload | null;
  phase: Phase;
  notice: Notice | null;
  mediaError: MediaErrorReason | null;

  /** Whether this device has a camera. False means the user joins with audio only. */
  hasCamera: boolean;
  /** What the user has switched on. Remembered across partners. */
  localMedia: MediaFlags;

  // ---- Everything below describes ONE conversation and is reset when it is over ----

  /** The current session while in_session; otherwise null. */
  sessionId: string | null;
  /** This browser's role in call setup (see services/peer.ts). */
  polite: boolean;
  iceServers: IceServer[];
  messages: ChatMessage[];
  /** Why the last session ended, while phase is partner_left. */
  endReason: SessionEndReason | null;
  /** What the partner has switched on, as they last told us. */
  partnerMedia: MediaFlags;
  call: CallState;
}

export type ChatEvent =
  // Connection
  | { type: 'connected' }
  | { type: 'connection_lost' }
  | { type: 'server_full' }
  | { type: 'status'; status: StatusPayload }
  // User actions
  | { type: 'start_requested' }
  | { type: 'next_requested' }
  | { type: 'leave_requested' }
  | { type: 'notice_dismissed' }
  | { type: 'mic_toggled' }
  | { type: 'camera_toggled' }
  | { type: 'message_sent'; id: string; text: string }
  // Camera and microphone
  | { type: 'media_ready'; hasCamera: boolean }
  | { type: 'media_failed'; reason: MediaErrorReason }
  // Server replies and events
  | { type: 'request_refused'; reason: Notice }
  | { type: 'waiting' }
  | { type: 'matched'; sessionId: string; polite: boolean; iceServers: IceServer[] }
  | { type: 'session_ended'; sessionId: string; reason: SessionEndReason }
  | { type: 'message_delivered'; id: string }
  | { type: 'message_failed'; id: string }
  | { type: 'message_received'; id: string; sessionId: string; text: string }
  | { type: 'partner_media'; sessionId: string; audio: boolean; video: boolean }
  // The direct audio/video connection
  | { type: 'call_state'; sessionId: string; call: CallState };

/** The fields that describe one conversation, in their "no conversation" state. */
const NO_SESSION = {
  sessionId: null,
  polite: false,
  iceServers: [],
  messages: [],
  endReason: null,
  partnerMedia: { audio: true, video: true },
  call: 'connecting',
} satisfies Partial<ChatState>;

export const initialChatState: ChatState = {
  connection: 'connecting',
  status: null,
  phase: 'idle',
  notice: null,
  mediaError: null,
  hasCamera: true,
  localMedia: { audio: true, video: true },
  ...NO_SESSION,
};

function withDelivery(state: ChatState, id: string, delivery: ChatMessage['delivery']): ChatState {
  return {
    ...state,
    messages: state.messages.map((message) =>
      message.id === id ? { ...message, delivery } : message,
    ),
  };
}

export function chatReducer(state: ChatState, event: ChatEvent): ChatState {
  /** True while the user wants to be matched or is in a chat. */
  const wantsChat = state.phase === 'waiting' || state.phase === 'in_session';
  /** True if `sessionId` is the conversation currently on screen and still running. */
  const isCurrentSession = (sessionId: string): boolean =>
    state.phase === 'in_session' && state.sessionId === sessionId;

  switch (event.type) {
    case 'connected':
      return { ...state, connection: 'connected' };

    case 'connection_lost': {
      // A new connection is a fresh start on the server, so any chat is over.
      const wasBusy = state.phase !== 'idle' && state.phase !== 'media_error';
      return {
        ...state,
        ...NO_SESSION,
        connection: 'reconnecting',
        phase: wasBusy ? 'idle' : state.phase,
        notice: wasBusy ? 'connection_lost' : state.notice,
      };
    }

    case 'server_full':
      return { ...state, ...NO_SESSION, connection: 'full', phase: 'idle', mediaError: null };

    case 'status':
      return { ...state, status: event.status };

    case 'start_requested':
      // From the landing page, or "Try again" on the camera problem screen.
      if (state.phase !== 'idle' && state.phase !== 'media_error') return state;
      if (state.connection !== 'connected') return state;
      return {
        ...state,
        ...NO_SESSION,
        phase: 'requesting_media',
        notice: null,
        mediaError: null,
      };

    case 'media_ready': {
      if (state.phase !== 'requesting_media') return state;
      const localMedia = event.hasCamera ? state.localMedia : { ...state.localMedia, video: false };
      return { ...state, phase: 'waiting', hasCamera: event.hasCamera, localMedia };
    }

    case 'media_failed':
      if (state.phase !== 'requesting_media') return state;
      return { ...state, phase: 'media_error', mediaError: event.reason };

    case 'next_requested':
      if (state.phase !== 'in_session' && state.phase !== 'partner_left') return state;
      return { ...state, ...NO_SESSION, phase: 'waiting', notice: null };

    case 'leave_requested':
      return { ...state, ...NO_SESSION, phase: 'idle', mediaError: null };

    case 'notice_dismissed':
      return { ...state, notice: null };

    case 'mic_toggled':
      return { ...state, localMedia: { ...state.localMedia, audio: !state.localMedia.audio } };

    case 'camera_toggled':
      if (!state.hasCamera) return state;
      return { ...state, localMedia: { ...state.localMedia, video: !state.localMedia.video } };

    case 'request_refused':
      // The server said no to Start or Next (closed, too fast, or no reply).
      return { ...state, ...NO_SESSION, phase: 'idle', notice: event.reason };

    case 'waiting':
      if (!wantsChat) return state;
      return { ...state, ...NO_SESSION, phase: 'waiting' };

    case 'matched':
      if (!wantsChat) return state;
      return {
        ...state,
        ...NO_SESSION,
        phase: 'in_session',
        sessionId: event.sessionId,
        polite: event.polite,
        iceServers: event.iceServers,
      };

    case 'session_ended':
      if (!isCurrentSession(event.sessionId)) return state;
      // Keep the messages on screen so the user can still read them.
      return { ...state, phase: 'partner_left', sessionId: null, endReason: event.reason };

    case 'message_sent':
      if (state.phase !== 'in_session') return state;
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: event.id, from: 'me', text: event.text, delivery: 'sending' },
        ],
      };

    case 'message_delivered':
      return withDelivery(state, event.id, 'sent');

    case 'message_failed':
      return withDelivery(state, event.id, 'failed');

    case 'message_received':
      if (!isCurrentSession(event.sessionId)) return state;
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: event.id, from: 'stranger', text: event.text, delivery: 'sent' },
        ],
      };

    case 'partner_media':
      if (!isCurrentSession(event.sessionId)) return state;
      return { ...state, partnerMedia: { audio: event.audio, video: event.video } };

    case 'call_state':
      if (!isCurrentSession(event.sessionId)) return state;
      return { ...state, call: event.call };
  }
}

/**
 * Whether new chats can be started at `nowMs`, judged from the last status the server
 * sent. The browser works this out itself between updates, so the landing page can flip
 * from "opens in 5 s" to open (and back at closing time) without asking the server again.
 * The server still has the final say: it refuses a Start while closed.
 */
export function isOpenAt(status: StatusPayload | null, nowMs: number): boolean {
  if (!status) return false;
  if (status.open) return status.closesAt === null || nowMs < status.closesAt;
  return status.opensAt !== null && nowMs >= status.opensAt;
}
