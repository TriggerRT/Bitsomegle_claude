import type { ClientToServerEvents, ServerToClientEvents } from '@bitsomeggle/shared';
import { io, type Socket } from 'socket.io-client';

/**
 * The connection to the Bitsomeggle server, typed with the shared contract: TypeScript
 * knows every event name and payload, so a typo or a wrong field fails at compile time.
 */
export type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** How long to wait for the server's reply to a request before giving up. */
export const REQUEST_TIMEOUT_MS = 8000;

/**
 * Creates the socket without connecting yet (the caller attaches its listeners first,
 * then calls `connect()`, so no early event can be missed).
 *
 * If the connection drops, Socket.IO keeps retrying by itself with growing pauses.
 */
export function createChatSocket(serverUrl: string): ChatSocket {
  return io(serverUrl, { autoConnect: false });
}

/**
 * Where the server lives.
 * - Production: the address is baked in at build time from VITE_SERVER_URL.
 * - Development: if not set, assume the server runs on port 3001 of the same machine
 *   that served this page.
 */
export function getServerUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL;
  if (configured) return configured;
  if (import.meta.env.DEV) return `${window.location.protocol}//${window.location.hostname}:3001`;
  throw new Error('VITE_SERVER_URL was not set when this app was built');
}
