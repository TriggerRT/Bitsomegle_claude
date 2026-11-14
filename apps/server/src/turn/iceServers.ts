import type { IceServer } from '@bitsomeggle/shared';

/**
 * The helper servers a browser needs to set up a direct video call (docs/ARCHITECTURE.md §2.3).
 *
 * For now this is only a free STUN server, which tells each browser its public address.
 * That is enough when a direct path exists (same Wi-Fi, most home networks).
 *
 * Milestone M5 adds a TURN relay here for networks that block direct paths. TURN needs
 * short-lived credentials fetched from Cloudflare; they will be refreshed in the background
 * and read from memory, so that handing them out at match time stays synchronous.
 */
const STUN_ONLY: readonly IceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];

export function getIceServers(): IceServer[] {
  return STUN_ONLY.map((server) => ({ ...server }));
}
