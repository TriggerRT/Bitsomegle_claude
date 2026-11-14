import type { IceServer, SignalPayload } from '@bitsomeggle/shared';
import type { CallState } from '../state/chatMachine.ts';

/** Removes a field from every member of a union type. */
type Without<T, K extends string> = T extends unknown ? Omit<T, K> : never;

/**
 * A call-setup message without the session id: either a session description (an offer or
 * an answer) or one ICE candidate. The controller adds the session id when sending and
 * checks it when receiving.
 */
export type Signal = Without<SignalPayload, 'sessionId'>;

export interface PeerOptions {
  /** Our role if both sides start setup at once. Decided by the server. */
  polite: boolean;
  iceServers: IceServer[];
  /** Our microphone and camera. */
  localStream: MediaStream;
  /** Called when we have a setup message for the partner. */
  sendSignal: (signal: Signal) => void;
  /** Called when the partner's audio and video arrive. */
  onRemoteStream: (stream: MediaStream) => void;
  onCallState: (state: CallState) => void;
  /** Called if a setup step fails unexpectedly. */
  onError: (error: unknown) => void;
}

export interface PeerLink {
  /** Handles a setup message that arrived from the partner. */
  handleSignal: (signal: Signal) => void;
  /** Ends the call and releases the connection. Safe to call more than once. */
  close: () => void;
}

/** Extracts the setup part of a `signal` event from the server. */
export function toSignal(payload: SignalPayload): Signal {
  return 'description' in payload
    ? { description: payload.description }
    : { candidate: payload.candidate };
}

/**
 * Sets up the direct audio/video connection to one partner. One of these is created per
 * conversation and closed when the conversation ends; it is never reused.
 *
 * To start a call, one browser sends an "offer" and the other replies with an "answer".
 * The server gives the two browsers opposite roles, and we use them like this:
 *
 * 1. FIRST OFFER: the IMPOLITE side always makes it. The polite side waits for it.
 *    Both sides have a camera to share, so without this rule both would send an offer at
 *    the same moment (a collision, also called "glare").
 *
 * 2. LATER COLLISIONS: handled by the "perfect negotiation" pattern from the WebRTC
 *    specification (docs/ARCHITECTURE.md §2.4). On a collision the POLITE side drops its
 *    own offer and accepts the other one; the IMPOLITE side ignores the incoming offer.
 *    Nothing in the app renegotiates today (mic and camera buttons only pause tracks),
 *    so this is a safety net for future features.
 *
 * Why rule 1 exists (found by testing, docs/DECISIONS.md D-029): when the polite side has
 * to abandon its own offer, Chromium stops gathering network routes for that connection
 * and the call never connects. Deciding who offers first avoids ever getting there.
 */
export function createPeerLink(options: PeerOptions): PeerLink {
  const { polite, sendSignal, onRemoteStream, onCallState, onError } = options;
  const connection = new RTCPeerConnection({ iceServers: options.iceServers });

  let closed = false;
  /** True if we (the impolite side) decided to ignore the partner's colliding offer. */
  let ignoringOffer = false;

  /**
   * Setup steps must not overlap, so each one waits for the previous one to finish.
   * Because of that, "we have sent an offer and are waiting for the answer" is always
   * visible as `signalingState === 'have-local-offer'` when the next step starts.
   */
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (step: () => Promise<void>): void => {
    queue = queue.then(async () => {
      if (closed) return;
      try {
        await step();
      } catch (error) {
        if (!closed) onError(error);
      }
    });
  };

  const sendLocalDescription = (): void => {
    const local = connection.localDescription;
    if (local) sendSignal({ description: { type: local.type, sdp: local.sdp } });
  };

  // The browser fires this when there is something new to agree on, for example right
  // after we add our camera and microphone below.
  connection.onnegotiationneeded = () => {
    enqueue(async () => {
      // Rule 1: the polite side never makes the first offer. Its camera and microphone
      // are included in the answer it gives to the impolite side's offer instead.
      if (polite && connection.remoteDescription === null) return;

      // With no argument the browser creates the right description itself (an offer here).
      await connection.setLocalDescription();
      sendLocalDescription();
    });
  };

  // "ICE candidates" are possible network routes to us. Each one found is sent to the partner.
  connection.onicecandidate = ({ candidate }) => {
    if (!candidate || closed) return;
    const { candidate: line, sdpMid, sdpMLineIndex, usernameFragment } = candidate.toJSON();
    sendSignal({ candidate: { candidate: line ?? '', sdpMid, sdpMLineIndex, usernameFragment } });
  };

  connection.ontrack = ({ streams }) => {
    const [stream] = streams;
    if (stream && !closed) onRemoteStream(stream);
  };

  connection.onconnectionstatechange = () => {
    if (closed) return;
    const state = connection.connectionState;
    if (state === 'connected') onCallState('connected');
    else if (state === 'failed') onCallState('failed');
    // 'disconnected' is usually a short network hiccup that recovers by itself.
    else if (state === 'connecting' || state === 'disconnected') onCallState('connecting');
  };

  // Offer our microphone and camera to the partner. This triggers `onnegotiationneeded`.
  for (const track of options.localStream.getTracks()) {
    connection.addTrack(track, options.localStream);
  }

  const handleSignal = (signal: Signal): void => {
    enqueue(async () => {
      if ('description' in signal) {
        const { description } = signal;
        // An offer arriving while our own offer is still unanswered is a collision.
        const collision = description.type === 'offer' && connection.signalingState !== 'stable';

        ignoringOffer = !polite && collision;
        if (ignoringOffer) return;

        // If we are polite and there was a collision, the browser automatically rolls
        // back our own offer when it accepts the partner's here.
        await connection.setRemoteDescription(description);
        if (description.type === 'offer') {
          await connection.setLocalDescription();
          sendLocalDescription();
        }
        return;
      }

      try {
        await connection.addIceCandidate(signal.candidate);
      } catch (error) {
        // Candidates that belong to an offer we chose to ignore are expected to fail.
        if (!ignoringOffer) throw error;
      }
    });
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    connection.onnegotiationneeded = null;
    connection.onicecandidate = null;
    connection.ontrack = null;
    connection.onconnectionstatechange = null;
    // This stops sending, but does NOT switch off the camera: the same camera stream is
    // reused for the next partner.
    connection.close();
  };

  return { handleSignal, close };
}
