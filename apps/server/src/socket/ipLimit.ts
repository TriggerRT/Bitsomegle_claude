import type { IncomingHttpHeaders } from 'node:http';

/**
 * Per-IP connection cap: stops one computer from opening hundreds of connections and
 * filling the server by itself.
 *
 * It is deliberately generous. On campus, hundreds of students share ONE public IP
 * address (docs/DECISIONS.md D-013), so a low cap would lock out real people.
 *
 * PRIVACY: addresses are held in memory only while their connections are open. They are
 * never logged and never sent to anyone.
 */
export class ConnectionCounter {
  private readonly counts = new Map<string, number>();

  count(ip: string): number {
    return this.counts.get(ip) ?? 0;
  }

  add(ip: string): void {
    this.counts.set(ip, this.count(ip) + 1);
  }

  remove(ip: string): void {
    const remaining = this.count(ip) - 1;
    // Forget the address completely once its last connection is gone.
    if (remaining > 0) this.counts.set(ip, remaining);
    else this.counts.delete(ip);
  }

  /** How many different addresses are connected right now. */
  get size(): number {
    return this.counts.size;
  }
}

/** Headers in which hosting proxies commonly report the visitor's address. */
export const KNOWN_IP_HEADERS = ['true-client-ip', 'cf-connecting-ip', 'x-forwarded-for'] as const;

const MAX_IP_LENGTH = 64;

/**
 * Works out which IP address a connection really comes from.
 *
 * In production the server sits behind the host's proxy, so the connection itself always
 * appears to come from the proxy. The proxy writes the visitor's address into a request
 * header instead; `header` names which one to trust. Only trust a header that the proxy
 * overwrites: one that visitors can set themselves would let them pretend to be someone
 * else and use up that person's allowance.
 *
 * Returns null when the address is unknown; the caller then does not count the connection.
 */
export function clientIpOf(
  handshake: { address: string; headers: IncomingHttpHeaders },
  header: string | null,
): string | null {
  if (header === null) return handshake.address || null;

  const raw = handshake.headers[header];
  const value = Array.isArray(raw) ? raw[0] : raw;
  // Some headers hold a list ("visitor, proxy1, proxy2"); the visitor comes first.
  const first = value?.split(',')[0]?.trim();
  if (!first || first.length > MAX_IP_LENGTH) return null;
  return first;
}
