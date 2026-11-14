import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CREDENTIAL_TTL_SECONDS,
  createCloudflareTurnSource,
  REFRESH_INTERVAL_MS,
  RETRY_INTERVAL_MS,
} from '../../src/turn/cloudflareTurn.ts';
import { createStunOnlySource, type IceServerSource } from '../../src/turn/iceServers.ts';

const STUN_ONLY = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const API_TOKEN = 'secret-api-token';

/** What Cloudflare answers, in the shape its documentation shows. */
function cloudflareAnswer(credential: string) {
  return {
    iceServers: [
      { urls: ['stun:stun.cloudflare.com:3478'] },
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turns:turn.cloudflare.com:443?transport=tcp',
        ],
        username: `user-for-${credential}`,
        credential,
      },
    ],
  };
}

const ok = (body: unknown): Response => Response.json(body, { status: 201 });

describe('STUN-only source', () => {
  it('always returns the free STUN server', async () => {
    const source = createStunOnlySource();
    await source.start();
    expect(source.getIceServers()).toEqual(STUN_ONLY);
  });

  it('hands out a fresh copy each time', () => {
    const source = createStunOnlySource();
    source.getIceServers().push({ urls: 'turn:evil.example' });
    expect(source.getIceServers()).toEqual(STUN_ONLY);
  });
});

describe('Cloudflare TURN source', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const logger = { info: vi.fn(), warn: vi.fn() };
  let source: IceServerSource;

  beforeEach(() => {
    // Pretend time: the test moves the clock forward itself instead of really waiting.
    vi.useFakeTimers();
    fetchMock.mockReset();
    logger.info.mockReset();
    logger.warn.mockReset();
    source = createCloudflareTurnSource({
      keyId: 'key-123',
      apiToken: API_TOKEN,
      logger,
      now: Date.now,
      fetch: fetchMock,
    });
  });

  afterEach(() => {
    source.stop();
    vi.useRealTimers();
  });

  it('gives STUN only until the first credentials have arrived', () => {
    expect(source.getIceServers()).toEqual(STUN_ONLY);
  });

  it('asks Cloudflare the documented way', async () => {
    fetchMock.mockResolvedValue(ok(cloudflareAnswer('first')));

    await source.start();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://rtc.live.cloudflare.com/v1/turn/keys/key-123/credentials/generate-ice-servers',
    );
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({ ttl: CREDENTIAL_TTL_SECONDS });
  });

  it("hands out Cloudflare's servers once they have arrived", async () => {
    fetchMock.mockResolvedValue(ok(cloudflareAnswer('first')));

    await source.start();

    expect(source.getIceServers()).toEqual(cloudflareAnswer('first').iceServers);
  });

  it('replaces the credentials with fresh ones every hour', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(cloudflareAnswer('first')))
      .mockResolvedValueOnce(ok(cloudflareAnswer('second')));
    await source.start();

    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(source.getIceServers()).toEqual(cloudflareAnswer('second').iceServers);
  });

  describe('when Cloudflare cannot be used', () => {
    it.each([
      ['the network fails', () => Promise.reject(new TypeError('fetch failed'))],
      ['Cloudflare refuses', () => Promise.resolve(Response.json({}, { status: 401 }))],
      ['the answer is not JSON', () => Promise.resolve(new Response('<html>', { status: 200 }))],
      ['the answer has the wrong shape', () => Promise.resolve(ok({ servers: [] }))],
      [
        'the answer has no relay in it',
        () => Promise.resolve(ok({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] })),
      ],
    ])('falls back to STUN only if %s on the first try', async (_name, respond) => {
      fetchMock.mockImplementation(respond);

      await source.start(); // must not throw

      expect(source.getIceServers()).toEqual(STUN_ONLY);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('tries again a minute later', async () => {
      fetchMock
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(ok(cloudflareAnswer('late')));
      await source.start();

      await vi.advanceTimersByTimeAsync(RETRY_INTERVAL_MS);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(source.getIceServers()).toEqual(cloudflareAnswer('late').iceServers);
    });

    it('keeps the previous credentials while they are still valid', async () => {
      fetchMock.mockResolvedValueOnce(ok(cloudflareAnswer('first')));
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      await source.start();

      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS + 5 * RETRY_INTERVAL_MS);

      expect(fetchMock.mock.calls.length).toBeGreaterThan(2);
      expect(source.getIceServers()).toEqual(cloudflareAnswer('first').iceServers);
    });

    it('stops handing out credentials once they have expired', async () => {
      fetchMock.mockResolvedValueOnce(ok(cloudflareAnswer('first')));
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      await source.start();

      await vi.advanceTimersByTimeAsync(CREDENTIAL_TTL_SECONDS * 1000 - 1);
      expect(source.getIceServers()).toEqual(cloudflareAnswer('first').iceServers);

      await vi.advanceTimersByTimeAsync(1);
      expect(source.getIceServers()).toEqual(STUN_ONLY);
    });
  });

  it('never writes the API token or the credentials to the log', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(cloudflareAnswer('very-secret-credential')))
      .mockRejectedValueOnce(new Error(`request with ${API_TOKEN} failed`))
      .mockResolvedValueOnce(Response.json({ error: API_TOKEN }, { status: 403 }));
    await source.start();
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS + RETRY_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).not.toContain(API_TOKEN);
    expect(logged).not.toContain('very-secret-credential');
  });

  it('stops refreshing after stop()', async () => {
    fetchMock.mockResolvedValue(ok(cloudflareAnswer('first')));
    await source.start();

    source.stop();
    await vi.advanceTimersByTimeAsync(3 * REFRESH_INTERVAL_MS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not schedule anything if stopped while a request is still under way', async () => {
    let answer: (response: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const started = source.start();

    source.stop();
    answer(ok(cloudflareAnswer('first')));
    await started;
    await vi.advanceTimersByTimeAsync(3 * REFRESH_INTERVAL_MS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
