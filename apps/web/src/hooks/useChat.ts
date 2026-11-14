import type { AckResult } from '@bitsomeggle/shared';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { type ChatSocket, createChatSocket, REQUEST_TIMEOUT_MS } from '../services/socket.ts';
import {
  type ChatState,
  chatReducer,
  initialChatState,
  type Notice,
} from '../state/chatMachine.ts';

export interface Chat {
  state: ChatState;
  start: () => void;
  next: () => void;
  leave: () => void;
  sendMessage: (text: string) => void;
  dismissNotice: () => void;
  /** Try to connect again after the server reported it was full. */
  retryConnection: () => void;
}

const noReplyNeeded = (): void => {};

/**
 * Connects the three pieces of the chat together for React:
 * - the socket (network),
 * - the state machine (what is going on),
 * - and the functions the buttons call.
 *
 * It contains no decisions of its own. Server events are forwarded to the state machine,
 * and user actions are sent both to the state machine (so the screen reacts instantly)
 * and to the server.
 */
export function useChat(serverUrl: string): Chat {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const socketRef = useRef<ChatSocket | null>(null);

  // Button handlers need the latest state without being re-created on every change.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const socket = createChatSocket(serverUrl);
    socketRef.current = socket;

    socket.on('connect', () => dispatch({ type: 'connected' }));
    socket.on('disconnect', (reason) => {
      dispatch({ type: 'connection_lost' });
      // After being disconnected BY the server, Socket.IO does not retry on its own.
      if (reason === 'io server disconnect') socket.connect();
    });
    socket.on('connect_error', (error) => {
      if (error.message === 'server_full') dispatch({ type: 'server_full' });
    });

    socket.on('status', (status) => dispatch({ type: 'status', status }));
    socket.on('queue:waiting', () => dispatch({ type: 'waiting' }));
    socket.on('session:matched', ({ sessionId, polite }) =>
      dispatch({ type: 'matched', sessionId, polite }),
    );
    socket.on('session:ended', ({ sessionId, reason }) =>
      dispatch({ type: 'session_ended', sessionId, reason }),
    );
    socket.on('chat:message', ({ sessionId, text }) =>
      dispatch({ type: 'message_received', id: crypto.randomUUID(), sessionId, text }),
    );

    socket.connect();

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [serverUrl]);

  /**
   * Sends Start or Next and handles a "no". If the server refuses (closed, too fast) or
   * does not answer, we go back to the landing page AND tell the server to drop whatever
   * it has for us, so the two sides cannot disagree about whether we are in a chat.
   */
  const requestMatch = useCallback(async (send: (socket: ChatSocket) => Promise<AckResult>) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;

    let refusal: Notice | null = null;
    try {
      const reply = await send(socket);
      if (!reply.ok) refusal = reply.code;
    } catch {
      // Socket.IO rejects the promise when no reply arrives within the timeout.
      refusal = 'timeout';
    }

    if (refusal !== null) {
      dispatch({ type: 'request_refused', reason: refusal });
      socket.emit('leave', noReplyNeeded);
    }
  }, []);

  const start = useCallback(() => {
    const { phase, connection } = stateRef.current;
    if (phase !== 'idle' || connection !== 'connected') return;
    dispatch({ type: 'start_requested' });
    void requestMatch((socket) => socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck('queue:join'));
  }, [requestMatch]);

  const next = useCallback(() => {
    const { phase, sessionId } = stateRef.current;
    if (phase !== 'in_session' && phase !== 'partner_left') return;
    dispatch({ type: 'next_requested' });
    void requestMatch((socket) =>
      // While in a chat, Next names that chat, so the server can ignore a duplicate
      // press that arrives after we have already been given a new partner.
      // After the partner left there is no chat to end; just look for someone new.
      sessionId !== null
        ? socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck('session:next', { sessionId })
        : socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck('queue:join'),
    );
  }, [requestMatch]);

  const leave = useCallback(() => {
    dispatch({ type: 'leave_requested' });
    socketRef.current?.emit('leave', noReplyNeeded);
  }, []);

  const sendMessage = useCallback((rawText: string) => {
    const socket = socketRef.current;
    const { phase, sessionId } = stateRef.current;
    const text = rawText.trim();
    if (!socket?.connected || phase !== 'in_session' || sessionId === null || text === '') return;

    const id = crypto.randomUUID();
    dispatch({ type: 'message_sent', id, text });
    socket
      .timeout(REQUEST_TIMEOUT_MS)
      .emitWithAck('chat:send', { sessionId, text })
      .then(
        (reply) => dispatch({ type: reply.ok ? 'message_delivered' : 'message_failed', id }),
        () => dispatch({ type: 'message_failed', id }),
      );
  }, []);

  const dismissNotice = useCallback(() => dispatch({ type: 'notice_dismissed' }), []);
  const retryConnection = useCallback(() => socketRef.current?.connect(), []);

  return { state, start, next, leave, sendMessage, dismissNotice, retryConnection };
}
