import { randomUUID } from 'node:crypto';
import { findPartner } from './findPartner.ts';
import type {
  ClientId,
  ClientState,
  ClientView,
  MatchEffect,
  SessionEndReason,
  SessionId,
} from './types.ts';

interface ClientRecord {
  readonly id: ClientId;
  state: ClientState;
  sessionId: SessionId | null;
  lastPartner: ClientId | null;
  /**
   * Ids here are never cleaned up when the other client disconnects. That is safe:
   * ids are never reused, and this set is deleted together with its own client.
   */
  readonly avoid: Set<ClientId>;
}

interface Session {
  readonly id: SessionId;
  readonly a: ClientId;
  readonly b: ClientId;
}

export interface MatchmakerOptions {
  /** Replace the random session id generator (tests use this to get predictable ids). */
  generateSessionId?: () => SessionId;
}

export interface NextOptions {
  /** Also make sure this client is never paired with the skipped partner again. */
  avoidPartner?: boolean;
}

/**
 * The heart of Bitsomeggle: decides who is waiting, who is talking to whom, and what
 * happens on Next, leave and disconnect.
 *
 * HARD RULE: every method here is synchronous. Never add `async`/`await`.
 * Node runs one piece of JavaScript at a time and only switches at an `await`, so a method
 * without one always finishes before any other event is handled. That is what stops two
 * people grabbing the same partner at the same moment. See docs/ARCHITECTURE.md §2.2.
 *
 * This class knows nothing about sockets. Methods return `MatchEffect`s describing who must
 * be told what, and the socket layer delivers them.
 *
 * Operations on an unknown client id do nothing and return no effects. Events can
 * legitimately arrive for a client that has just disconnected, so this is not an error.
 */
export class Matchmaker {
  private readonly clients = new Map<ClientId, ClientRecord>();
  /** A Set remembers insertion order, so iterating it gives the oldest waiter first. */
  private readonly queue = new Set<ClientId>();
  private readonly sessions = new Map<SessionId, Session>();
  private readonly generateSessionId: () => SessionId;

  constructor(options: MatchmakerOptions = {}) {
    this.generateSessionId = options.generateSessionId ?? randomUUID;
  }

  /** Registers a newly connected client as idle. Calling it again for the same id does nothing. */
  connect(clientId: ClientId): void {
    if (this.clients.has(clientId)) return;
    this.clients.set(clientId, {
      id: clientId,
      state: 'idle',
      sessionId: null,
      lastPartner: null,
      avoid: new Set(),
    });
  }

  /**
   * "Find me a partner." Pairs the client immediately if someone suitable is waiting,
   * otherwise puts them in the queue.
   * Idempotent: if the client is already waiting or in a session, nothing happens, so
   * double clicks and duplicate events are harmless.
   */
  join(clientId: ClientId): MatchEffect[] {
    const client = this.clients.get(clientId);
    if (client?.state !== 'idle') return [];
    return this.enqueueOrMatch(client);
  }

  /**
   * The Next button: "end the session I think I am in, then find me someone new."
   *
   * `sessionId` is the session the client believes it is in. If the client has already been
   * moved to a NEWER session (for example by a double click on Next), the request is stale
   * and is ignored, so one click can never skip a partner the user has not even seen.
   * If the session is already over (the partner left first), this simply joins the queue.
   */
  next(clientId: ClientId, sessionId: SessionId, options: NextOptions = {}): MatchEffect[] {
    const client = this.clients.get(clientId);
    if (!client) return [];

    if (client.state === 'in_session') {
      if (client.sessionId !== sessionId) return [];
      const effects = this.endSessionOf(client, 'partner_next');
      if (options.avoidPartner && client.lastPartner !== null) {
        client.avoid.add(client.lastPartner);
      }
      return [...effects, ...this.enqueueOrMatch(client)];
    }

    return this.join(clientId);
  }

  /**
   * "Take me out of everything." Leaves the queue or ends the current session, and makes
   * the client idle. It takes no session id on purpose: a leave always means "stop now",
   * whatever the client is currently in.
   */
  leave(clientId: ClientId): MatchEffect[] {
    const client = this.clients.get(clientId);
    if (!client) return [];
    return this.detach(client, 'partner_left');
  }

  /** The client's connection is gone: remove every trace of them and tell their partner. */
  disconnect(clientId: ClientId): MatchEffect[] {
    const client = this.clients.get(clientId);
    if (!client) return [];
    const effects = this.detach(client, 'partner_disconnected');
    this.clients.delete(clientId);
    return effects;
  }

  /** The client's current state, or undefined if they are not connected. */
  getClient(clientId: ClientId): ClientView | undefined {
    const client = this.clients.get(clientId);
    return client && { state: client.state, sessionId: client.sessionId };
  }

  /**
   * Who to relay a message to. Returns the partner only if `sessionId` is the sender's
   * CURRENT session, so a late message from an old conversation is never delivered to a
   * new partner.
   */
  getPartner(clientId: ClientId, sessionId: SessionId): ClientId | null {
    const client = this.clients.get(clientId);
    if (client?.state !== 'in_session' || client.sessionId !== sessionId) return null;
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return session.a === clientId ? session.b : session.a;
  }

  /** Counts for the "N people online" indicator and for monitoring. */
  stats(): { clients: number; waiting: number; sessions: number } {
    return {
      clients: this.clients.size,
      waiting: this.queue.size,
      sessions: this.sessions.size,
    };
  }

  /**
   * Throws if the internal state breaks any rule from docs/ARCHITECTURE.md §3.3.
   * Tests call this after every operation. It is not used in normal request handling.
   */
  assertInvariants(): void {
    const fail = (message: string): never => {
      throw new Error(`Matchmaker invariant violated: ${message}`);
    };

    for (const id of this.queue) {
      const client = this.clients.get(id);
      if (!client) fail(`queue contains unknown client ${id}`);
      else if (client.state !== 'waiting') fail(`queued client ${id} has state ${client.state}`);
    }

    let clientsInSession = 0;
    for (const client of this.clients.values()) {
      if ((client.state === 'waiting') !== this.queue.has(client.id)) {
        fail(`client ${client.id} is ${client.state} but queue membership disagrees`);
      }
      if ((client.state === 'in_session') !== (client.sessionId !== null)) {
        fail(`client ${client.id} is ${client.state} with sessionId ${client.sessionId}`);
      }
      if (client.sessionId !== null) {
        clientsInSession += 1;
        const session = this.sessions.get(client.sessionId);
        if (!session) fail(`client ${client.id} points to missing session ${client.sessionId}`);
        else if (session.a !== client.id && session.b !== client.id) {
          fail(`client ${client.id} is not a member of its session ${session.id}`);
        }
      }
    }

    for (const session of this.sessions.values()) {
      if (session.a === session.b) fail(`session ${session.id} pairs ${session.a} with itself`);
      for (const memberId of [session.a, session.b]) {
        const member = this.clients.get(memberId);
        if (!member) fail(`session ${session.id} has unknown member ${memberId}`);
        else if (member.sessionId !== session.id) {
          fail(`member ${memberId} of session ${session.id} points to ${member.sessionId}`);
        }
      }
    }

    if (clientsInSession !== this.sessions.size * 2) {
      fail(`${clientsInSession} clients in sessions but ${this.sessions.size} sessions`);
    }

    // Nobody may be left waiting while a suitable partner is also waiting.
    const waiting = [...this.waitingClients()];
    for (const client of waiting) {
      const partner = findPartner(client, waiting);
      if (partner !== null) fail(`${client.id} and ${partner} are both waiting but could match`);
    }
  }

  /** Pairs an idle client with the best waiting partner, or queues them if there is none. */
  private enqueueOrMatch(client: ClientRecord): MatchEffect[] {
    const partnerId = findPartner(client, this.waitingClients());

    if (partnerId === null) {
      client.state = 'waiting';
      this.queue.add(client.id);
      return [{ type: 'waiting', to: client.id }];
    }

    const partner = this.getKnownClient(partnerId);
    this.queue.delete(partner.id);

    const sessionId = this.generateSessionId();
    this.sessions.set(sessionId, { id: sessionId, a: partner.id, b: client.id });
    for (const member of [partner, client]) {
      member.state = 'in_session';
      member.sessionId = sessionId;
    }

    // Exactly one side must be "polite" so the two browsers never disagree about who
    // backs off if both start the call setup at once (docs/ARCHITECTURE.md §2.4).
    // Which one is arbitrary: we pick the client who arrived second.
    return [
      { type: 'matched', to: partner.id, sessionId, polite: false },
      { type: 'matched', to: client.id, sessionId, polite: true },
    ];
  }

  /** Removes a client from the queue or from their session, leaving them idle. */
  private detach(client: ClientRecord, reasonForPartner: SessionEndReason): MatchEffect[] {
    if (client.state === 'in_session') return this.endSessionOf(client, reasonForPartner);
    if (client.state === 'waiting') {
      this.queue.delete(client.id);
      client.state = 'idle';
    }
    return [];
  }

  /**
   * Ends the session `client` is in. Both members become idle in this one step, so the
   * session can never be half finished. Only the partner is notified: the client who
   * caused the ending already knows.
   */
  private endSessionOf(client: ClientRecord, reasonForPartner: SessionEndReason): MatchEffect[] {
    const session = client.sessionId === null ? undefined : this.sessions.get(client.sessionId);
    if (!session) throw new Error(`Matchmaker bug: client ${client.id} has no session to end`);

    const partner = this.getKnownClient(session.a === client.id ? session.b : session.a);
    this.sessions.delete(session.id);

    client.state = 'idle';
    client.sessionId = null;
    client.lastPartner = partner.id;

    partner.state = 'idle';
    partner.sessionId = null;
    partner.lastPartner = client.id;

    return [
      { type: 'session_ended', to: partner.id, sessionId: session.id, reason: reasonForPartner },
    ];
  }

  private *waitingClients(): Generator<ClientRecord> {
    for (const id of this.queue) yield this.getKnownClient(id);
  }

  private getKnownClient(clientId: ClientId): ClientRecord {
    const client = this.clients.get(clientId);
    if (!client) throw new Error(`Matchmaker bug: unknown client ${clientId}`);
    return client;
  }
}
