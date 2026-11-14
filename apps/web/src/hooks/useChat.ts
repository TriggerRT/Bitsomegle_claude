import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatController, type ChatSnapshot, INITIAL_SNAPSHOT } from '../services/chatController.ts';
import { acquireLocalMedia, stopMedia } from '../services/localMedia.ts';
import { createPeerLink } from '../services/peer.ts';
import { createChatSocket } from '../services/socket.ts';

export interface ChatActions {
  start: () => void;
  next: () => void;
  leave: () => void;
  sendMessage: (text: string) => void;
  toggleMic: () => void;
  toggleCamera: () => void;
  dismissNotice: () => void;
  /** Try to connect again after the server reported it was full. */
  retryConnection: () => void;
}

export type Chat = ChatSnapshot & ChatActions;

/**
 * Gives React components the chat: the current snapshot (state + video streams) and the
 * functions the buttons call.
 *
 * All behaviour lives in ChatController. This hook only creates one with the real
 * network, camera and call services, re-renders when it publishes a change, and shuts it
 * down when the page goes away.
 */
export function useChat(serverUrl: string): Chat {
  const controllerRef = useRef<ChatController | null>(null);
  const [snapshot, setSnapshot] = useState<ChatSnapshot>(INITIAL_SNAPSHOT);

  useEffect(() => {
    const controller = new ChatController({
      socket: createChatSocket(serverUrl),
      acquireMedia: acquireLocalMedia,
      stopMedia,
      createPeer: createPeerLink,
      newId: () => crypto.randomUUID(),
      reportError: (message, error) => console.error(message, error),
    });
    controllerRef.current = controller;

    const unsubscribe = controller.subscribe(() => setSnapshot(controller.getSnapshot()));
    controller.connect();

    return () => {
      unsubscribe();
      controller.destroy();
      controllerRef.current = null;
      setSnapshot(INITIAL_SNAPSHOT);
    };
  }, [serverUrl]);

  // The same function objects for the whole life of the component.
  const actions = useMemo<ChatActions>(
    () => ({
      start: () => controllerRef.current?.start(),
      next: () => controllerRef.current?.next(),
      leave: () => controllerRef.current?.leave(),
      sendMessage: (text) => controllerRef.current?.sendMessage(text),
      toggleMic: () => controllerRef.current?.toggleMic(),
      toggleCamera: () => controllerRef.current?.toggleCamera(),
      dismissNotice: () => controllerRef.current?.dismissNotice(),
      retryConnection: () => controllerRef.current?.retryConnection(),
    }),
    [],
  );

  return { ...snapshot, ...actions };
}
