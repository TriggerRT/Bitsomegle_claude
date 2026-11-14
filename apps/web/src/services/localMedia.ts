import type { MediaErrorReason } from '../state/chatMachine.ts';

/** Thrown when the camera or microphone cannot be used. `reason` says why. */
export class MediaAccessError extends Error {
  readonly reason: MediaErrorReason;

  constructor(reason: MediaErrorReason, cause?: unknown) {
    super(`Could not access camera or microphone: ${reason}`, { cause });
    this.name = 'MediaAccessError';
    this.reason = reason;
  }
}

const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true };

/**
 * A modest picture size on purpose. It keeps calls smooth on weak campus Wi-Fi and keeps
 * relay (TURN) data use low. `ideal` means "aim for this, but accept what the camera has".
 */
const VIDEO: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  facingMode: 'user',
};

/** Browsers report failures as a DOMException whose `name` says what went wrong. */
function toReason(error: unknown): MediaErrorReason {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no_device';
  if (name === 'NotReadableError' || name === 'AbortError') return 'in_use';
  return 'unknown';
}

/**
 * Asks the browser for the microphone and camera. The first call shows the browser's
 * permission prompt.
 *
 * If the device has no camera (many desktop PCs), it falls back to microphone only, and
 * the user joins as an audio-only participant. Check `stream.getVideoTracks().length`.
 *
 * The returned stream is "live": the camera light stays on until `stopMedia` is called.
 */
export async function acquireLocalMedia(): Promise<MediaStream> {
  // Browsers only offer camera access on secure pages (https, or localhost while developing).
  if (!navigator.mediaDevices?.getUserMedia) throw new MediaAccessError('insecure');

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: VIDEO });
  } catch (error) {
    if (toReason(error) !== 'no_device') throw new MediaAccessError(toReason(error), error);
  }

  // Either the camera or the microphone is missing. Try the microphone alone.
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: AUDIO });
  } catch (error) {
    throw new MediaAccessError(toReason(error), error);
  }
}

/** Switches the devices off for good (the camera light goes out). */
export function stopMedia(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
