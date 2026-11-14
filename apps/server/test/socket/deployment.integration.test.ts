/**
 * Features that only matter once the server is deployed: the TURN relay credentials and
 * the per-IP connection cap. Tested here against a real server with pretend browsers.
 */
import type { MatchedPayload } from '@bitsomeggle/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pair, startTestServer, type TestServer } from './helpers.ts';

describe('TURN relay credentials', () => {
  let server: TestServer;

  afterEach(async () => {
    await server.stop();
  });

  const RELAY = {
    urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
    username: 'short-lived-user',
    credential: 'short-lived-password',
  };
  const turn = { keyId: 'key-123', apiToken: 'secret-api-token' };

  async function matchTwo(): Promise<[MatchedPayload, MatchedPayload]> {
    const a = await server.connect();
    const b = await server.connect();
    await a.request('queue:join');
    await b.request('queue:join');
    return Promise.all([
      a.next<MatchedPayload>('session:matched'),
      b.next<MatchedPayload>('session:matched'),
    ]);
  }

  it('gives both matched browsers the relay once the credentials have been fetched', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ iceServers: [RELAY] }));
    server = await startTestServer({ turn }, { fetch: fetchMock });
    await server.app.iceServers.start();

    const [forA, forB] = await matchTwo();

    expect(forA.iceServers).toEqual([RELAY]);
    expect(forB.iceServers).toEqual([RELAY]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // from memory, not one request per match
  });

  it('never sends the long-lived API token to a browser', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ iceServers: [RELAY] }));
    server = await startTestServer({ turn }, { fetch: fetchMock });
    await server.app.iceServers.start();
    const a = await server.connect();
    const b = await server.connect();
    await pair(a, b);

    expect(JSON.stringify([a.log, b.log])).not.toContain(turn.apiToken);
  });

  it('still matches people, with STUN only, when Cloudflare cannot be reached', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    server = await startTestServer({ turn }, { fetch: fetchMock });
    await server.app.iceServers.start();

    const [forA] = await matchTwo();

    expect(forA.iceServers).toEqual([{ urls: 'stun:stun.cloudflare.com:3478' }]);
  });
});

describe('per-IP connection cap', () => {
  let server: TestServer;

  afterEach(async () => {
    await server.stop();
  });

  const HEADER = 'true-client-ip';
  const from = (ip: string) => ({ [HEADER]: ip });

  it('refuses one address above its cap but still accepts other addresses', async () => {
    server = await startTestServer({ maxClientsPerIp: 2, clientIpHeader: HEADER });
    await server.connect(from('1.1.1.1'));
    await server.connect(from('1.1.1.1'));

    const third = server.connectRaw(from('1.1.1.1'));
    await expect(third.waitUntilConnected()).rejects.toThrow('server_full');

    const other = await server.connect(from('2.2.2.2'));
    expect(other.status.online).toBe(3);
  });

  it('frees the place again when a connection from that address closes', async () => {
    server = await startTestServer({ maxClientsPerIp: 1, clientIpHeader: HEADER });
    const first = await server.connect(from('1.1.1.1'));

    first.close();
    await expect.poll(() => server.app.matchmaker.stats().clients).toBe(0);

    await server.connect(from('1.1.1.1'));
  });

  it('does not count connections whose address is unknown', async () => {
    server = await startTestServer({ maxClientsPerIp: 1, clientIpHeader: HEADER });

    // No header at all, as if the proxy were set up differently than we expect. Refusing
    // everybody would be far worse than not limiting, so these are let in.
    await server.connect();
    await server.connect();
  });

  it('uses the connection itself as the address when there is no proxy', async () => {
    server = await startTestServer({ maxClientsPerIp: 1, clientIpHeader: null });
    await server.connect();

    // Both test connections come from this machine. A made-up header changes nothing.
    const second = server.connectRaw(from('9.9.9.9'));
    await expect(second.waitUntilConnected()).rejects.toThrow('server_full');
  });

  it('is off by default', async () => {
    server = await startTestServer({ clientIpHeader: HEADER });
    for (let i = 0; i < 5; i += 1) await server.connect(from('1.1.1.1'));
  });
});
