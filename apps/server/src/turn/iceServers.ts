import type { IceServer } from '@bitsomeggle/shared';

/**
 * Where the server gets the list of helper servers that browsers need to set up a video
 * call (docs/ARCHITECTURE.md §2.3). Two kinds exist:
 *
 * - `createStunOnlySource()` (this file): a free STUN server, which tells each browser
 *   its public address. Enough when a direct path exists (same Wi-Fi, most home networks).
 * - `createCloudflareTurnSource()` (cloudflareTurn.ts): STUN plus a TURN relay, for
 *   networks that block direct paths.
 */
export interface IceServerSource {
  /**
   * The list to hand to two browsers that were just matched.
   *
   * This must stay SYNCHRONOUS (no waiting): it is called while a match is being
   * delivered, and matching may never pause half-way (CLAUDE.md, hard rule 2). Anything
   * slow, like asking Cloudflare for credentials, happens in the background beforehand.
   */
  getIceServers(): IceServer[];
  /** Prepares the first list. Resolves when ready or when the attempt failed; never rejects. */
  start(): Promise<void>;
  /** Stops any background work. */
  stop(): void;
}

export const STUN_SERVERS: readonly IceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];

/** A fresh copy each time, so no caller can change the list for everyone else. */
export function copyIceServers(servers: readonly IceServer[]): IceServer[] {
  return servers.map((server) => ({ ...server }));
}

export function createStunOnlySource(): IceServerSource {
  return {
    getIceServers: () => copyIceServers(STUN_SERVERS),
    start: () => Promise.resolve(),
    stop: () => {},
  };
}
