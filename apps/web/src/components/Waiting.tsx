import type { Chat } from '../hooks/useChat.ts';
import { MediaControls } from './MediaControls.tsx';
import { ReconnectingBanner } from './ReconnectingBanner.tsx';
import { VideoTile } from './VideoTile.tsx';

interface WaitingProps {
  chat: Chat;
}

/** Shown while looking for a partner. The preview lets users check how they look first. */
export function Waiting({ chat }: WaitingProps) {
  const { state } = chat;

  return (
    <main className="screen waiting">
      <div className="preview">
        <VideoTile stream={chat.localStream} isSelf label="Your video" testId="local-video" />
        {!state.localMedia.video && (
          <p className="overlay">
            {state.hasCamera
              ? 'Your camera is off'
              : 'No camera found. You will join with audio only.'}
          </p>
        )}
      </div>

      <ReconnectingBanner state={state} />

      <div className="waiting-line">
        <div className="spinner" aria-hidden="true" />
        <p className="status-line" role="status">
          Looking for someone…
        </p>
      </div>

      {state.thanksForReport && (
        <p className="hint" role="status">
          Thanks, your report was noted. You won't be matched with that person again.
        </p>
      )}
      {!state.thanksForReport && state.status !== null && state.status.online <= 1 && (
        <p className="hint">
          Nobody else is online right now. Stay here and you'll be matched when someone arrives.
        </p>
      )}

      <div className="actions">
        <MediaControls
          state={state}
          onToggleMic={chat.toggleMic}
          onToggleCamera={chat.toggleCamera}
        />
        <button type="button" className="secondary" onClick={chat.leave}>
          Cancel
        </button>
      </div>
    </main>
  );
}
