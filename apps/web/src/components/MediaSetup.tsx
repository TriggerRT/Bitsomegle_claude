import type { ChatState, MediaErrorReason } from '../state/chatMachine.ts';

const PROBLEM: Record<MediaErrorReason, { title: string; help: string }> = {
  denied: {
    title: 'Camera and microphone are blocked',
    help: 'Click the camera or lock icon next to the address bar, allow camera and microphone for this site, then try again.',
  },
  no_device: {
    title: 'No microphone found',
    help: 'Plug in a microphone or headset, then try again. A camera is optional.',
  },
  in_use: {
    title: 'Your camera or microphone is busy',
    help: 'Another app (Zoom, Meet, Teams, the Camera app) may be using it. Close that app, then try again.',
  },
  insecure: {
    title: "This page can't use the camera",
    help: 'Browsers only allow camera access on secure (https) pages. Open the site using its https address.',
  },
  unknown: {
    title: "Couldn't start your camera or microphone",
    help: 'Try again. If it keeps happening, restart your browser.',
  },
};

interface MediaSetupProps {
  state: ChatState;
  onRetry: () => void;
  onBack: () => void;
}

/** Shown while the browser asks for camera permission, and if that fails. */
export function MediaSetup({ state, onRetry, onBack }: MediaSetupProps) {
  if (state.phase === 'requesting_media') {
    return (
      <main className="screen landing">
        <div className="spinner" aria-hidden="true" />
        <p className="status-line" role="status">
          Allow camera and microphone to continue.
        </p>
        <p className="hint">Your browser may be showing a prompt near the address bar.</p>
        <button type="button" className="secondary" onClick={onBack}>
          Cancel
        </button>
      </main>
    );
  }

  const problem = PROBLEM[state.mediaError ?? 'unknown'];
  return (
    <main className="screen landing">
      <h1 className="problem-title" role="alert">
        {problem.title}
      </h1>
      <p className="tagline">{problem.help}</p>
      <div className="actions">
        <button type="button" className="secondary" onClick={onBack}>
          Back
        </button>
        <button type="button" className="primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    </main>
  );
}
