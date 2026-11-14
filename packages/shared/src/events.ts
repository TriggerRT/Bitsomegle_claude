/**
 * The contract between the web app and the server: every event either side may send,
 * and the exact shape of its payload.
 *
 * Messages from a browser can never be trusted (anyone can open the console and send
 * anything), so each client-to-server payload has a zod "schema". A schema is a
 * description of the allowed shape that can check real data at runtime. The TypeScript
 * types are generated from the same schemas, so the check and the types cannot drift apart.
 */
import { z } from 'zod';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  ICE_CANDIDATE_MAX_LENGTH,
  SDP_MAX_LENGTH,
  SESSION_ID_MAX_LENGTH,
} from './constants.ts';

// ---------------------------------------------------------------------------
// Client -> server payloads (validated on the server)
// ---------------------------------------------------------------------------

const sessionIdSchema = z.string().min(1).max(SESSION_ID_MAX_LENGTH);

/** `session:next`: the Next button. Names the session the browser believes it is in. */
export const nextSchema = z.object({ sessionId: sessionIdSchema });
export type NextPayload = z.infer<typeof nextSchema>;

/** `chat:send`: one text message. Surrounding whitespace is removed; empty messages are rejected. */
export const chatSendSchema = z.object({
  sessionId: sessionIdSchema,
  text: z.string().trim().min(1).max(CHAT_MESSAGE_MAX_LENGTH),
});
export type ChatSendPayload = z.infer<typeof chatSendSchema>;

/** `media:state`: whether the sender's microphone and camera are currently on. */
export const mediaStateSchema = z.object({
  sessionId: sessionIdSchema,
  audio: z.boolean(),
  video: z.boolean(),
});
export type MediaStatePayload = z.infer<typeof mediaStateSchema>;

/** Same fields as the browser's RTCSessionDescriptionInit. */
const descriptionSchema = z.object({
  type: z.enum(['offer', 'answer', 'pranswer', 'rollback']),
  sdp: z.string().max(SDP_MAX_LENGTH).optional(),
});

/** Same fields as the browser's RTCIceCandidateInit. */
const candidateSchema = z.object({
  candidate: z.string().max(ICE_CANDIDATE_MAX_LENGTH),
  sdpMid: z.string().max(64).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(255).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
});

/**
 * `signal`: one WebRTC call-setup message, carrying either a session description or an
 * ICE candidate. The server does not understand these; it only checks the shape and size
 * and passes them to the partner. Fields not listed here are removed before relaying.
 */
export const signalSchema = z.union([
  z.object({ sessionId: sessionIdSchema, description: descriptionSchema }),
  z.object({ sessionId: sessionIdSchema, candidate: candidateSchema }),
]);
export type SignalPayload = z.infer<typeof signalSchema>;

// ---------------------------------------------------------------------------
// Server -> client payloads
// ---------------------------------------------------------------------------

/** Why a session ended, as told to the partner who did not end it. */
export type SessionEndReason = 'partner_next' | 'partner_left' | 'partner_disconnected';

/**
 * Why the server refused a request.
 * - invalid: the payload did not match the schema
 * - rate_limited: too many requests too quickly
 * - closed: outside opening hours, so no new matches
 * - not_in_session: the message named a session the sender is not (or no longer) in
 */
export type ErrorCode = 'invalid' | 'rate_limited' | 'closed' | 'not_in_session';

/**
 * The server's reply to a request. Socket.IO calls this an "acknowledgement" (ack):
 * the client passes a callback with the event, and the server calls it with this value.
 */
export type AckResult = { ok: true } | { ok: false; code: ErrorCode };
export type Ack = (result: AckResult) => void;

export interface StatusPayload {
  /** Whether new matches can be made right now. */
  open: boolean;
  /** When the site next opens (milliseconds since 1970), or null if it is open now. */
  opensAt: number | null;
  /** When the current opening window ends, or null if closed or always open. */
  closesAt: number | null;
  /** How many browsers are connected right now. */
  online: number;
}

/**
 * One STUN or TURN server for WebRTC. Same shape as the browser's RTCIceServer, so the
 * list can be passed straight to `new RTCPeerConnection({ iceServers })`.
 */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface MatchedPayload {
  sessionId: string;
  /** Which role this browser plays if both sides start call setup at once. */
  polite: boolean;
  /** Servers the browser uses to find a path to the partner for audio and video. */
  iceServers: IceServer[];
}

export interface SessionEndedPayload {
  sessionId: string;
  reason: SessionEndReason;
}

export interface ChatMessagePayload {
  sessionId: string;
  text: string;
  /** Server time the message was relayed (milliseconds since 1970). */
  at: number;
}

// ---------------------------------------------------------------------------
// Event maps (used to type Socket.IO on both sides)
// ---------------------------------------------------------------------------

export interface ClientToServerEvents {
  'queue:join': (ack: Ack) => void;
  'session:next': (payload: NextPayload, ack: Ack) => void;
  leave: (ack: Ack) => void;
  'chat:send': (payload: ChatSendPayload, ack: Ack) => void;
  signal: (payload: SignalPayload) => void;
  'media:state': (payload: MediaStatePayload) => void;
}

export interface ServerToClientEvents {
  status: (payload: StatusPayload) => void;
  'queue:waiting': () => void;
  'session:matched': (payload: MatchedPayload) => void;
  'session:ended': (payload: SessionEndedPayload) => void;
  'chat:message': (payload: ChatMessagePayload) => void;
  signal: (payload: SignalPayload) => void;
  'media:state': (payload: MediaStatePayload) => void;
  /** Sent when a request without an ack callback is refused. */
  'server:error': (payload: { code: ErrorCode }) => void;
}
