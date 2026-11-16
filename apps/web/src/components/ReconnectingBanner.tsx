import type { ChatState } from '../state/chatMachine.ts';

/**
 * Shown on the waiting and call screens while the connection to the server is down.
 * The video may well keep playing meanwhile, because it does not go through the server.
 */
export function ReconnectingBanner({ state }: { state: ChatState }) {
  if (state.connection !== 'reconnecting') return null;
  return (
    <p className="banner" role="status">
      Connection lost. Reconnecting…
    </p>
  );
}
