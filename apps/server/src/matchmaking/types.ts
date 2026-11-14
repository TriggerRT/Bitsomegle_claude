import type { SessionEndReason } from '@bitsomeggle/shared';

/** Server-side id of one connected browser (the socket id). Never sent to other clients. */
export type ClientId = string;

/** Random id of one conversation. Also acts as a version number to reject stale events. */
export type SessionId = string;

/**
 * Where a client is in the matchmaking lifecycle.
 * - idle: connected, but not looking for a partner
 * - waiting: in the queue
 * - in_session: paired with exactly one other client
 */
export type ClientState = 'idle' | 'waiting' | 'in_session';

/**
 * Something the outside world must be told after a matchmaking operation.
 * The Matchmaker never sends anything itself: it returns these, and the socket layer
 * (Milestone M2) turns each one into an event for the client named in `to`.
 */
export type MatchEffect =
  | { type: 'waiting'; to: ClientId }
  | { type: 'matched'; to: ClientId; sessionId: SessionId; polite: boolean }
  | { type: 'session_ended'; to: ClientId; sessionId: SessionId; reason: SessionEndReason };

/** What the outside world may know about a client's matchmaking state. */
export interface ClientView {
  state: ClientState;
  sessionId: SessionId | null;
}
