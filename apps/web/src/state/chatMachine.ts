/**
 * The web app's "state machine": the single place that decides what the user is doing
 * right now (idle, waiting, talking, partner left) and therefore which screen is shown.
 *
 * It is a "reducer": a function that takes the current state and one event, and returns
 * the next state. It never talks to the network, the clock or the screen, which makes
 * every transition easy to test (see chatMachine.test.ts).
 *
 * Events come from two places:
 * - the user (pressed Start, Next, Leave, sent a message), and
 * - the server (you are waiting, you are matched, your session ended, a message arrived).
 *
 * KEY RULE for staying in step with the server: an event from the server can be late.
 * For example, the user presses Leave a split second after the server matched them; the
 * "matched" event then arrives while the user is already back on the landing page.
 * So server events are only applied when they still make sense:
 * - `waiting` and `matched` only while the user is actually looking for or in a chat;
 * - `session_ended` and incoming messages only if they name the current session.
 */
import type { ErrorCode, SessionEndReason, StatusPayload } from '@bitsomeggle/shared';

/**
 * - connecting: first connection attempt in progress
 * - connected: ready
 * - reconnecting: the connection dropped and is being re-established
 * - full: the server refused us because it is at capacity
 */
export type Connection = 'connecting' | 'connected' | 'reconnecting' | 'full';

/**
 * - idle: on the landing page
 * - waiting: looking for a partner
 * - in_session: talking to a partner
 * - partner_left: the partner ended the chat; the old conversation is still on screen
 */
export type Phase = 'idle' | 'waiting' | 'in_session' | 'partner_left';

/** Something to tell the user on the landing page after being sent back there. */
export type Notice = ErrorCode | 'timeout' | 'connection_lost';

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
  /** The current session while in_session; otherwise null. */
  sessionId: string | null;
  /** This browser's role in video call setup (used from Milestone M4). */
  polite: boolean;
  messages: ChatMessage[];
  /** Why the last session ended, while phase is partner_left. */
  endReason: SessionEndReason | null;
  notice: Notice | null;
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
  | { type: 'message_sent'; id: string; text: string }
  // Server replies and events
  | { type: 'request_refused'; reason: Notice }
  | { type: 'waiting' }
  | { type: 'matched'; sessionId: string; polite: boolean }
  | { type: 'session_ended'; sessionId: string; reason: SessionEndReason }
  | { type: 'message_delivered'; id: string }
  | { type: 'message_failed'; id: string }
  | { type: 'message_received'; id: string; sessionId: string; text: string };

export const initialChatState: ChatState = {
  connection: 'connecting',
  status: null,
  phase: 'idle',
  sessionId: null,
  polite: false,
  messages: [],
  endReason: null,
  notice: null,
};

/** The fields that describe one conversation, reset whenever a conversation is over. */
const NO_SESSION = {
  sessionId: null,
  polite: false,
  messages: [],
  endReason: null,
} satisfies Partial<ChatState>;

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

  switch (event.type) {
    case 'connected':
      return { ...state, connection: 'connected' };

    case 'connection_lost': {
      // A new connection is a fresh start on the server, so any chat is over.
      const wasBusy = state.phase !== 'idle';
      return {
        ...state,
        ...NO_SESSION,
        connection: 'reconnecting',
        phase: 'idle',
        notice: wasBusy ? 'connection_lost' : state.notice,
      };
    }

    case 'server_full':
      return { ...state, ...NO_SESSION, connection: 'full', phase: 'idle' };

    case 'status':
      return { ...state, status: event.status };

    case 'start_requested':
      if (state.phase !== 'idle' || state.connection !== 'connected') return state;
      return { ...state, ...NO_SESSION, phase: 'waiting', notice: null };

    case 'next_requested':
      if (state.phase !== 'in_session' && state.phase !== 'partner_left') return state;
      return { ...state, ...NO_SESSION, phase: 'waiting', notice: null };

    case 'leave_requested':
      return { ...state, ...NO_SESSION, phase: 'idle' };

    case 'notice_dismissed':
      return { ...state, notice: null };

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
      };

    case 'session_ended':
      if (state.phase !== 'in_session' || state.sessionId !== event.sessionId) return state;
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
      if (state.phase !== 'in_session' || state.sessionId !== event.sessionId) return state;
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: event.id, from: 'stranger', text: event.text, delivery: 'sent' },
        ],
      };
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
