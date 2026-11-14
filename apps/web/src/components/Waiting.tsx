import type { Chat } from '../hooks/useChat.ts';
import { MediaControls } from './MediaControls.tsx';
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

      <div className="waiting-line">
        <div className="spinner" aria-hidden="true" />
        <p className="status-line" role="status">
          Looking for someone…
        </p>
      </div>

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
