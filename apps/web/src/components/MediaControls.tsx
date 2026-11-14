import type { ChatState } from '../state/chatMachine.ts';

interface MediaControlsProps {
  state: ChatState;
  onToggleMic: () => void;
  onToggleCamera: () => void;
}

/** The microphone and camera on/off buttons. */
export function MediaControls({ state, onToggleMic, onToggleCamera }: MediaControlsProps) {
  const { localMedia, hasCamera } = state;

  return (
    <>
      <button
        type="button"
        className={localMedia.audio ? 'secondary' : 'secondary off'}
        aria-pressed={!localMedia.audio}
        onClick={onToggleMic}
      >
        {localMedia.audio ? 'Mute' : 'Unmute'}
      </button>
      <button
        type="button"
        className={localMedia.video ? 'secondary' : 'secondary off'}
        aria-pressed={!localMedia.video}
        onClick={onToggleCamera}
        disabled={!hasCamera}
        title={hasCamera ? undefined : 'No camera found on this device'}
      >
        {localMedia.video ? 'Camera off' : 'Camera on'}
      </button>
    </>
  );
}
