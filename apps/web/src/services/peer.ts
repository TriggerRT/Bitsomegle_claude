import type { IceServer, SignalPayload } from '@bitsomeggle/shared';
import type { CallState } from '../state/chatMachine.ts';

/**
 * How long the call may stay interrupted before we try to find a new route.
 * Short interruptions usually heal by themselves within a second or two.
 */
export const INTERRUPTION_PATIENCE_MS = 4_000;
/** How long one attempt to find a new route may take before the call counts as failed. */
export const RECOVERY_DEADLINE_MS = 15_000;
/**
 * The most video we send, in bits per second. Plenty for a 640x480 picture. It keeps
 * calls usable on weak connections and keeps relayed calls cheap: at this rate one hour
 * of video is about 0.27 GB in each direction.
 */
export const MAX_VIDEO_BITRATE = 600_000;

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
  /**
   * Testing aid: only connect through the TURN relay, never directly. Used to check that
   * the relay really works (see `relayOnlyRequested` below).
   */
  relayOnly?: boolean;
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

/**
 * True if the page address asks for relay-only calls, like https://…/?relay=1.
 *
 * Normally two browsers connect directly whenever they can, so you cannot tell whether
 * the relay would have worked. Adding ?relay=1 forbids the direct path for that browser:
 * if video still connects, the relay works.
 */
export function relayOnlyRequested(search: string): boolean {
  return new URLSearchParams(search).get('relay') === '1';
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
 *
 * 3. WHEN THE CALL BREAKS (a phone switches from Wi-Fi to mobile data, say), the route
 *    between the two browsers is gone but the call itself can be saved by finding a new
 *    route. That is called an "ICE restart". We try it ONCE per breakdown, and for the
 *    same reason as rule 1 only the IMPOLITE side starts it; the polite side waits for
 *    the resulting offer. If the call is not back within RECOVERY_DEADLINE_MS, or breaks
 *    again straight away, the user is told the call failed and can press Next.
 */
export function createPeerLink(options: PeerOptions): PeerLink {
  const { polite, sendSignal, onRemoteStream, onCallState, onError } = options;
  const connection = new RTCPeerConnection({
    iceServers: options.iceServers,
    iceTransportPolicy: options.relayOnly ? 'relay' : 'all',
  });

  let closed = false;
  /** True from the moment a broken call is being rescued until it is connected again. */
  let recovering = false;
  let patienceTimer: ReturnType<typeof setTimeout> | null = null;
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  const clearTimers = (): void => {
    if (patienceTimer !== null) clearTimeout(patienceTimer);
    if (deadlineTimer !== null) clearTimeout(deadlineTimer);
    patienceTimer = null;
    deadlineTimer = null;
  };
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

  const giveUp = (): void => {
    clearTimers();
    // `recovering` stays true, so a further failure does not start yet another attempt.
    onCallState('failed');
  };

  /** Rule 3: one attempt to save a broken call. */
  const startRecovery = (): void => {
    if (recovering) {
      giveUp(); // it broke again during (or after) the one attempt
      return;
    }
    recovering = true;
    clearTimers();
    onCallState('connecting');
    // Asks the browser to look for new routes. That makes it fire `onnegotiationneeded`,
    // which sends a fresh offer to the partner.
    if (!polite) connection.restartIce();
    deadlineTimer = setTimeout(giveUp, RECOVERY_DEADLINE_MS);
  };

  /** Applies MAX_VIDEO_BITRATE to the video we send. */
  const limitVideoBitrate = (): void => {
    for (const sender of connection.getSenders()) {
      if (sender.track?.kind !== 'video') continue;
      const parameters = sender.getParameters();
      const encoding = parameters.encodings?.[0];
      if (!encoding || encoding.maxBitrate === MAX_VIDEO_BITRATE) continue;
      encoding.maxBitrate = MAX_VIDEO_BITRATE;
      // Not being able to set a limit is no reason to disturb the call.
      sender.setParameters(parameters).catch(onError);
    }
  };

  connection.onconnectionstatechange = () => {
    if (closed) return;
    const state = connection.connectionState;
    if (state === 'connected') {
      clearTimers();
      recovering = false;
      onCallState('connected');
      limitVideoBitrate();
    } else if (state === 'failed') {
      startRecovery();
    } else if (state === 'disconnected') {
      // Usually a short hiccup that heals by itself. If it lasts, try to rescue the call
      // without waiting for the browser to declare it failed (which takes much longer).
      onCallState('connecting');
      if (!recovering && patienceTimer === null) {
        patienceTimer = setTimeout(() => {
          patienceTimer = null;
          if (!closed && connection.connectionState === 'disconnected') startRecovery();
        }, INTERRUPTION_PATIENCE_MS);
      }
    } else if (state === 'connecting') {
      onCallState('connecting');
    }
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
    clearTimers();
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
