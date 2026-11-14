import { APP_NAME } from '@bitsomeggle/shared';
import { useNow } from '../hooks/useNow.ts';
import { formatCountdown } from '../lib/format.ts';
import { type ChatState, isOpenAt, type Notice } from '../state/chatMachine.ts';

const NOTICE_TEXT: Record<Notice, string> = {
  closed: 'Bitsomeggle is closed right now.',
  rate_limited: "You're going a bit fast. Wait a moment and try again.",
  invalid: 'Something went wrong. Please try again.',
  not_in_session: 'Something went wrong. Please try again.',
  timeout: 'The server did not answer. Please try again.',
  connection_lost: 'Your connection dropped, so the chat ended.',
};

interface LandingProps {
  state: ChatState;
  onStart: () => void;
  onDismissNotice: () => void;
  onRetryConnection: () => void;
}

export function Landing({ state, onStart, onDismissNotice, onRetryConnection }: LandingProps) {
  const now = useNow(1000);
  const { connection, status, notice } = state;
  const open = isOpenAt(status, now);
  const canStart = connection === 'connected' && open;

  return (
    <main className="screen landing">
      <h1 className="brand">{APP_NAME}</h1>
      <p className="tagline">Talk to a random BITSian. No sign-up, no names.</p>

      {notice && (
        <div className="notice" role="alert">
          <span>{NOTICE_TEXT[notice]}</span>
          <button type="button" className="link" onClick={onDismissNotice}>
            Dismiss
          </button>
        </div>
      )}

      <button type="button" className="primary big" onClick={onStart} disabled={!canStart}>
        Start chatting
      </button>

      <p className="hint" aria-live="polite">
        {connection === 'connecting' && 'Connecting…'}
        {connection === 'reconnecting' && 'Connection lost. Reconnecting…'}
        {connection === 'full' && (
          <>
            The server is full right now.{' '}
            <button type="button" className="link" onClick={onRetryConnection}>
              Try again
            </button>
          </>
        )}
        {connection === 'connected' && status && !open && status.opensAt !== null && (
          <>Closed right now. Opens in {formatCountdown(status.opensAt - now)}.</>
        )}
        {connection === 'connected' && status && !open && status.opensAt === null && (
          <>Closed for today. Come back tomorrow.</>
        )}
        {canStart && status && status.closesAt !== null && (
          <>Open for another {formatCountdown(status.closesAt - now)}.</>
        )}
      </p>
    </main>
  );
}
