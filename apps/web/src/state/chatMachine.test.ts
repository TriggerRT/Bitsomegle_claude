import type { StatusPayload } from '@bitsomeggle/shared';
import { describe, expect, it } from 'vitest';
import {
  type ChatEvent,
  type ChatState,
  chatReducer,
  initialChatState,
  isOpenAt,
} from './chatMachine.ts';

/** Plays a list of events from the initial state. */
function play(...events: ChatEvent[]): ChatState {
  return events.reduce(chatReducer, initialChatState);
}

const connected: ChatEvent = { type: 'connected' };
const start: ChatEvent = { type: 'start_requested' };
const matched = (sessionId: string, polite = false): ChatEvent => ({
  type: 'matched',
  sessionId,
  polite,
});
const received = (sessionId: string, text: string): ChatEvent => ({
  type: 'message_received',
  id: `in-${text}`,
  sessionId,
  text,
});
const sent = (text: string): ChatEvent => ({ type: 'message_sent', id: `out-${text}`, text });

describe('chatReducer', () => {
  describe('connection', () => {
    it('starts out connecting and idle', () => {
      expect(initialChatState).toMatchObject({ connection: 'connecting', phase: 'idle' });
    });

    it('stores the status sent by the server', () => {
      const status: StatusPayload = { open: true, opensAt: null, closesAt: null, online: 7 };
      expect(play(connected, { type: 'status', status }).status).toEqual(status);
    });

    it('cannot start before the connection is ready', () => {
      expect(play(start).phase).toBe('idle');
    });

    it('losing the connection during a chat ends it and says why', () => {
      const state = play(connected, start, matched('s1'), sent('hi'), { type: 'connection_lost' });
      expect(state).toMatchObject({
        connection: 'reconnecting',
        phase: 'idle',
        sessionId: null,
        messages: [],
        notice: 'connection_lost',
      });
    });

    it('losing the connection on the landing page shows no notice', () => {
      expect(play(connected, { type: 'connection_lost' }).notice).toBeNull();
    });

    it('reconnecting returns to a usable landing page', () => {
      const state = play(connected, start, { type: 'connection_lost' }, connected, start);
      expect(state).toMatchObject({ connection: 'connected', phase: 'waiting', notice: null });
    });

    it('a full server is reported and leaves the user idle', () => {
      expect(play({ type: 'server_full' })).toMatchObject({ connection: 'full', phase: 'idle' });
    });
  });

  describe('the main journey', () => {
    it('Start shows the waiting screen straight away', () => {
      expect(play(connected, start).phase).toBe('waiting');
    });

    it('a match opens an empty conversation and remembers the role', () => {
      expect(play(connected, start, { type: 'waiting' }, matched('s1', true))).toMatchObject({
        phase: 'in_session',
        sessionId: 's1',
        polite: true,
        messages: [],
      });
    });

    it('messages from both sides appear in order', () => {
      const state = play(connected, start, matched('s1'), sent('hello'), received('s1', 'hey'));
      expect(state.messages.map((m) => [m.from, m.text])).toEqual([
        ['me', 'hello'],
        ['stranger', 'hey'],
      ]);
    });

    it('my message is marked sent once the server accepts it', () => {
      const state = play(connected, start, matched('s1'), sent('hello'), {
        type: 'message_delivered',
        id: 'out-hello',
      });
      expect(state.messages[0]?.delivery).toBe('sent');
    });

    it('my message is marked failed if the server refuses it', () => {
      const state = play(connected, start, matched('s1'), sent('hello'), {
        type: 'message_failed',
        id: 'out-hello',
      });
      expect(state.messages[0]?.delivery).toBe('failed');
    });

    it('Next clears the old conversation and waits for a new partner', () => {
      const state = play(connected, start, matched('s1'), sent('hello'), {
        type: 'next_requested',
      });
      expect(state).toMatchObject({ phase: 'waiting', sessionId: null, messages: [] });
    });

    it('the next partner never sees or inherits old messages', () => {
      const state = play(
        connected,
        start,
        matched('s1'),
        received('s1', 'old message'),
        { type: 'next_requested' },
        matched('s2'),
      );
      expect(state).toMatchObject({ phase: 'in_session', sessionId: 's2', messages: [] });
    });

    it('Leave returns to the landing page with nothing left over', () => {
      const state = play(connected, start, matched('s1'), sent('hello'), {
        type: 'leave_requested',
      });
      expect(state).toMatchObject({ phase: 'idle', sessionId: null, messages: [] });
    });
  });

  describe('when the partner leaves', () => {
    const afterPartnerLeft = play(connected, start, matched('s1'), received('s1', 'bye'), {
      type: 'session_ended',
      sessionId: 's1',
      reason: 'partner_next',
    });

    it('shows that they left and keeps the conversation readable', () => {
      expect(afterPartnerLeft).toMatchObject({
        phase: 'partner_left',
        sessionId: null,
        endReason: 'partner_next',
      });
      expect(afterPartnerLeft.messages).toHaveLength(1);
    });

    it('no more messages can be added', () => {
      const state = [sent('anyone there?'), received('s1', 'late')].reduce(
        chatReducer,
        afterPartnerLeft,
      );
      expect(state.messages).toHaveLength(1);
    });

    it('Next looks for someone new', () => {
      const state = chatReducer(afterPartnerLeft, { type: 'next_requested' });
      expect(state).toMatchObject({ phase: 'waiting', messages: [], endReason: null });
    });

    it('Leave goes back to the landing page', () => {
      expect(chatReducer(afterPartnerLeft, { type: 'leave_requested' }).phase).toBe('idle');
    });
  });

  describe('late or out-of-date events from the server', () => {
    it('ignores "matched" that arrives after the user pressed Leave', () => {
      const state = play(connected, start, { type: 'leave_requested' }, matched('s1'));
      expect(state).toMatchObject({ phase: 'idle', sessionId: null });
    });

    it('ignores "waiting" that arrives after the user pressed Leave', () => {
      const state = play(connected, start, { type: 'leave_requested' }, { type: 'waiting' });
      expect(state.phase).toBe('idle');
    });

    it('ignores the ending of a session that is not the current one', () => {
      const state = play(
        connected,
        start,
        matched('s1'),
        { type: 'next_requested' },
        matched('s2'),
        {
          type: 'session_ended',
          sessionId: 's1',
          reason: 'partner_left',
        },
      );
      expect(state).toMatchObject({ phase: 'in_session', sessionId: 's2' });
    });

    it('ignores a message that belongs to an earlier session', () => {
      const state = play(
        connected,
        start,
        matched('s1'),
        { type: 'next_requested' },
        matched('s2'),
        received('s1', 'meant for the previous chat'),
      );
      expect(state.messages).toEqual([]);
    });

    it('ignores a message that arrives while waiting', () => {
      const state = play(connected, start, received('s1', 'stray'));
      expect(state.messages).toEqual([]);
    });

    it('follows the server when it reports a newer session than the one on screen', () => {
      // Start, Leave, Start in quick succession can deliver an out-of-date "matched"
      // first. Whatever the server says last is the truth.
      const state = play(connected, start, matched('s1'), matched('s2'));
      expect(state).toMatchObject({ phase: 'in_session', sessionId: 's2', messages: [] });
    });

    it('follows the server back to waiting', () => {
      const state = play(connected, start, matched('s1'), sent('x'), { type: 'waiting' });
      expect(state).toMatchObject({ phase: 'waiting', sessionId: null, messages: [] });
    });

    it('a delivery report for a message that is gone changes nothing', () => {
      const before = play(connected, start, matched('s1'));
      expect(chatReducer(before, { type: 'message_delivered', id: 'unknown' })).toEqual(before);
    });
  });

  describe('repeated presses', () => {
    it('Start while already waiting changes nothing', () => {
      const waiting = play(connected, start);
      expect(chatReducer(waiting, start)).toBe(waiting);
    });

    it('Next on the landing page changes nothing', () => {
      const idle = play(connected);
      expect(chatReducer(idle, { type: 'next_requested' })).toBe(idle);
    });

    it('Next while already waiting changes nothing', () => {
      const waiting = play(connected, start);
      expect(chatReducer(waiting, { type: 'next_requested' })).toBe(waiting);
    });
  });

  describe('when the server refuses Start or Next', () => {
    it.each(['closed', 'rate_limited', 'timeout'] as const)(
      'returns to the landing page with the reason "%s"',
      (reason) => {
        const state = play(connected, start, { type: 'request_refused', reason });
        expect(state).toMatchObject({ phase: 'idle', notice: reason });
      },
    );

    it('the notice can be dismissed', () => {
      const state = play(
        connected,
        start,
        { type: 'request_refused', reason: 'closed' },
        { type: 'notice_dismissed' },
      );
      expect(state.notice).toBeNull();
    });

    it('starting again clears the notice', () => {
      const state = play(connected, start, { type: 'request_refused', reason: 'timeout' }, start);
      expect(state).toMatchObject({ phase: 'waiting', notice: null });
    });
  });

  it('never changes the state object it was given', () => {
    const before = play(connected, start, matched('s1'), sent('hi'));
    const snapshot = structuredClone(before);
    chatReducer(before, received('s1', 'yo'));
    chatReducer(before, { type: 'next_requested' });
    chatReducer(before, { type: 'message_delivered', id: 'out-hi' });
    expect(before).toEqual(snapshot);
  });
});

describe('isOpenAt', () => {
  const base = { online: 1 };

  it('is closed until the first status arrives', () => {
    expect(isOpenAt(null, 0)).toBe(false);
  });

  it('is open when the server says so and there is no closing time', () => {
    expect(isOpenAt({ ...base, open: true, opensAt: null, closesAt: null }, 123)).toBe(true);
  });

  it('closes by itself at closing time', () => {
    const status = { ...base, open: true, opensAt: null, closesAt: 1000 };
    expect(isOpenAt(status, 999)).toBe(true);
    expect(isOpenAt(status, 1000)).toBe(false);
  });

  it('opens by itself at opening time', () => {
    const status = { ...base, open: false, opensAt: 1000, closesAt: null };
    expect(isOpenAt(status, 999)).toBe(false);
    expect(isOpenAt(status, 1000)).toBe(true);
  });
});
