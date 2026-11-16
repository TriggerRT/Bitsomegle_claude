import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallState } from '../state/chatMachine.ts';
import {
  createPeerLink,
  INTERRUPTION_PATIENCE_MS,
  MAX_VIDEO_BITRATE,
  type PeerLink,
  RECOVERY_DEADLINE_MS,
  relayOnlyRequested,
  type Signal,
} from './peer.ts';

describe('relayOnlyRequested', () => {
  it('is on only for ?relay=1', () => {
    expect(relayOnlyRequested('?relay=1')).toBe(true);
    expect(relayOnlyRequested('?other=x&relay=1')).toBe(true);
  });

  it.each(['', '?', '?relay', '?relay=0', '?relay=true', '?relayed=1'])(
    'is off for "%s"',
    (search) => {
      expect(relayOnlyRequested(search)).toBe(false);
    },
  );
});

// ---------------------------------------------------------------------------
// A stand-in for the browser's RTCPeerConnection. Real calls are tested in the browser
// tests (e2e/video.spec.ts); here the test decides what "the browser" reports, which is
// the only practical way to make a call break on demand.
// ---------------------------------------------------------------------------

class FakeSender {
  parameters: { encodings: Array<{ maxBitrate?: number }> } = { encodings: [{}] };
  readonly setParameters = vi.fn(async (parameters: typeof this.parameters) => {
    this.parameters = parameters;
  });
  readonly track: { kind: string };

  constructor(track: { kind: string }) {
    this.track = track;
  }

  getParameters(): typeof this.parameters {
    return structuredClone(this.parameters);
  }
}

class FakeConnection {
  static latest: FakeConnection;

  connectionState: RTCPeerConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: (() => void) | null = null;
  ontrack: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  readonly senders: FakeSender[] = [];
  readonly restartIce = vi.fn();
  readonly close = vi.fn();
  readonly addIceCandidate = vi.fn(async () => {});
  readonly setLocalDescription = vi.fn(async () => {
    const type =
      this.remoteDescription !== null && this.signalingState !== 'stable' ? 'answer' : 'offer';
    this.localDescription = { type, sdp: `fake ${type}` };
    this.signalingState = type === 'offer' ? 'have-local-offer' : 'stable';
  });
  readonly setRemoteDescription = vi.fn(async (description: { type: string; sdp: string }) => {
    this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
  });
  readonly configuration: RTCConfiguration;

  constructor(configuration: RTCConfiguration) {
    this.configuration = configuration;
    FakeConnection.latest = this;
  }

  addTrack(track: { kind: string }): FakeSender {
    const sender = new FakeSender(track);
    this.senders.push(sender);
    return sender;
  }

  getSenders(): FakeSender[] {
    return this.senders;
  }

  /** Pretends the browser reports a new state for the call. */
  becomes(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

describe('createPeerLink', () => {
  let link: PeerLink;
  let connection: FakeConnection;
  let callStates: CallState[];
  let signals: Signal[];
  let errors: unknown[];

  /** Lets the queued setup steps (which are promises) run. */
  const settle = (): Promise<void> => vi.advanceTimersByTimeAsync(0).then(() => {});

  function open({ polite }: { polite: boolean }): void {
    callStates = [];
    signals = [];
    errors = [];
    const tracks = [{ kind: 'audio' }, { kind: 'video' }];
    link = createPeerLink({
      polite,
      iceServers: [{ urls: 'stun:stun.example.org' }],
      localStream: { getTracks: () => tracks } as unknown as MediaStream,
      sendSignal: (signal) => signals.push(signal),
      onRemoteStream: () => {},
      onCallState: (state) => callStates.push(state),
      onError: (error) => errors.push(error),
    });
    connection = FakeConnection.latest;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('RTCPeerConnection', FakeConnection);
  });

  afterEach(() => {
    link.close();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('who makes the first offer (rule 1)', () => {
    it('the impolite side does', async () => {
      open({ polite: false });
      connection.onnegotiationneeded?.();
      await settle();
      expect(signals).toEqual([{ description: { type: 'offer', sdp: 'fake offer' } }]);
    });

    it('the polite side waits', async () => {
      open({ polite: true });
      connection.onnegotiationneeded?.();
      await settle();
      expect(signals).toEqual([]);
      expect(connection.setLocalDescription).not.toHaveBeenCalled();
    });

    it('the polite side answers the offer it receives', async () => {
      open({ polite: true });
      link.handleSignal({ description: { type: 'offer', sdp: 'their offer' } });
      await settle();
      expect(signals).toEqual([{ description: { type: 'answer', sdp: 'fake answer' } }]);
    });
  });

  describe('rescuing a broken call (rule 3)', () => {
    it('the impolite side looks for a new route instead of reporting failure', () => {
      open({ polite: false });
      connection.becomes('connected');
      connection.becomes('failed');

      expect(connection.restartIce).toHaveBeenCalledTimes(1);
      expect(callStates).toEqual(['connected', 'connecting']);
    });

    it('reports the call as connected again when the rescue works', () => {
      open({ polite: false });
      connection.becomes('connected');
      connection.becomes('failed');
      connection.becomes('connecting');
      connection.becomes('connected');
      vi.advanceTimersByTime(RECOVERY_DEADLINE_MS * 2);

      expect(callStates.at(-1)).toBe('connected');
      expect(callStates).not.toContain('failed');
    });

    it('gives up if the call breaks again during the one attempt', () => {
      open({ polite: false });
      connection.becomes('connected');
      connection.becomes('failed');
      connection.becomes('connecting');
      connection.becomes('failed');

      expect(connection.restartIce).toHaveBeenCalledTimes(1);
      expect(callStates.at(-1)).toBe('failed');
    });

    it('gives up if the attempt takes too long', () => {
      open({ polite: false });
      connection.becomes('connected');
      connection.becomes('failed');

      vi.advanceTimersByTime(RECOVERY_DEADLINE_MS - 1);
      expect(callStates.at(-1)).toBe('connecting');
      vi.advanceTimersByTime(1);
      expect(callStates.at(-1)).toBe('failed');
      expect(connection.restartIce).toHaveBeenCalledTimes(1);
    });

    it('a call that was rescued gets a new attempt the next time it breaks', () => {
      open({ polite: false });
      connection.becomes('connected');
      connection.becomes('failed');
      connection.becomes('connected');
      connection.becomes('failed');

      expect(connection.restartIce).toHaveBeenCalledTimes(2);
      expect(callStates.at(-1)).toBe('connecting');
    });

    it('the polite side never starts the rescue; it waits for the other side', () => {
      open({ polite: true });
      connection.becomes('connected');
      connection.becomes('failed');

      expect(connection.restartIce).not.toHaveBeenCalled();
      expect(callStates.at(-1)).toBe('connecting');

      vi.advanceTimersByTime(RECOVERY_DEADLINE_MS);
      expect(callStates.at(-1)).toBe('failed');
    });

    it('the polite side reports success when the other side rescues the call', () => {
      open({ polite: true });
      connection.becomes('connected');
      connection.becomes('failed');
      connection.becomes('connected');
      vi.advanceTimersByTime(RECOVERY_DEADLINE_MS * 2);

      expect(callStates.at(-1)).toBe('connected');
    });

    it('a call that never connected in the first place also gets one attempt', () => {
      open({ polite: false });
      connection.becomes('connecting');
      connection.becomes('failed');
      expect(connection.restartIce).toHaveBeenCalledTimes(1);
      connection.becomes('failed');
      expect(callStates.at(-1)).toBe('failed');
    });
  });

  describe('an interruption', () => {
    it('that heals quickly is left alone', () => {
      open({ polite: false });
      connection.becomes('connected');
      connection.becomes('disconnected');
      expect(callStates.at(-1)).toBe('connecting');

      vi.advanceTimersByTime(INTERRUPTION_PATIENCE_MS - 1);
      connection.becomes('connected');
      vi.advanceTimersByTime(RECOVERY_DEADLINE_MS * 2);

      expect(connection.restartIce).not.toHaveBeenCalled();
      expect(callStates.at(-1)).toBe('connected');
    });

    it('that lasts starts a rescue without waiting for the browser to declare failure', () => {
      open({ polite: false });
      connection.becomes('connected');
      connection.becomes('disconnected');

      vi.advanceTimersByTime(INTERRUPTION_PATIENCE_MS);

      expect(connection.restartIce).toHaveBeenCalledTimes(1);
    });

    it('followed by failure still means only one attempt', () => {
      open({ polite: false });
      connection.becomes('connected');
      connection.becomes('disconnected');
      vi.advanceTimersByTime(INTERRUPTION_PATIENCE_MS);
      connection.becomes('failed');

      expect(connection.restartIce).toHaveBeenCalledTimes(1);
      expect(callStates.at(-1)).toBe('failed');
    });
  });

  describe('closing', () => {
    it('cancels a rescue in progress and reports nothing more', () => {
      open({ polite: false });
      connection.becomes('connected');
      connection.becomes('failed');
      const reportedSoFar = callStates.length;

      link.close();
      vi.advanceTimersByTime(RECOVERY_DEADLINE_MS * 2);

      expect(callStates).toHaveLength(reportedSoFar);
      expect(connection.close).toHaveBeenCalledTimes(1);
    });

    it('cancels a pending interruption check', () => {
      open({ polite: false });
      connection.becomes('connected');
      connection.becomes('disconnected');

      link.close();
      vi.advanceTimersByTime(INTERRUPTION_PATIENCE_MS * 2);

      expect(connection.restartIce).not.toHaveBeenCalled();
    });
  });

  describe('video bitrate', () => {
    const videoSender = (): FakeSender | undefined =>
      connection.senders.find((sender) => sender.track.kind === 'video');
    const audioSender = (): FakeSender | undefined =>
      connection.senders.find((sender) => sender.track.kind === 'audio');

    it('is limited once the call is connected, for video only', () => {
      open({ polite: false });
      connection.becomes('connected');

      expect(videoSender()?.parameters.encodings[0]?.maxBitrate).toBe(MAX_VIDEO_BITRATE);
      expect(audioSender()?.setParameters).not.toHaveBeenCalled();
    });

    it('is not set again when the call reconnects', () => {
      open({ polite: false });
      connection.becomes('connected');
      connection.becomes('disconnected');
      connection.becomes('connected');

      expect(videoSender()?.setParameters).toHaveBeenCalledTimes(1);
    });

    it('a browser that reports nothing to limit does not disturb the call', () => {
      open({ polite: false });
      const sender = videoSender();
      if (sender) sender.parameters = { encodings: [] };

      connection.becomes('connected');

      expect(sender?.setParameters).not.toHaveBeenCalled();
      expect(errors).toEqual([]);
      expect(callStates).toEqual(['connected']);
    });

    it('a browser that refuses the limit is reported but the call goes on', async () => {
      open({ polite: false });
      videoSender()?.setParameters.mockRejectedValueOnce(new Error('not allowed'));

      connection.becomes('connected');
      await settle();

      expect(errors).toHaveLength(1);
      expect(callStates).toEqual(['connected']);
    });
  });
});
