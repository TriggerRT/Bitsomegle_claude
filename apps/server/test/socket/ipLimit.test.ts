import { describe, expect, it } from 'vitest';
import { ConnectionCounter, clientIpOf } from '../../src/socket/ipLimit.ts';

describe('ConnectionCounter', () => {
  it('counts connections per address', () => {
    const counter = new ConnectionCounter();
    counter.add('1.1.1.1');
    counter.add('1.1.1.1');
    counter.add('2.2.2.2');

    expect(counter.count('1.1.1.1')).toBe(2);
    expect(counter.count('2.2.2.2')).toBe(1);
    expect(counter.count('3.3.3.3')).toBe(0);
  });

  it('forgets an address when its last connection closes', () => {
    const counter = new ConnectionCounter();
    counter.add('1.1.1.1');
    counter.add('1.1.1.1');

    counter.remove('1.1.1.1');
    expect(counter.count('1.1.1.1')).toBe(1);
    expect(counter.size).toBe(1);

    counter.remove('1.1.1.1');
    expect(counter.count('1.1.1.1')).toBe(0);
    expect(counter.size).toBe(0);
  });

  it('never goes below zero', () => {
    const counter = new ConnectionCounter();
    counter.remove('1.1.1.1');
    expect(counter.count('1.1.1.1')).toBe(0);
    expect(counter.size).toBe(0);
  });
});

describe('clientIpOf', () => {
  const handshake = (headers: Record<string, string | string[]>) => ({
    address: '10.0.0.1', // the proxy, as seen by the server
    headers,
  });

  it('uses the connection address when there is no proxy', () => {
    expect(clientIpOf(handshake({ 'true-client-ip': '9.9.9.9' }), null)).toBe('10.0.0.1');
  });

  it('uses the configured header when behind a proxy', () => {
    expect(clientIpOf(handshake({ 'true-client-ip': '9.9.9.9' }), 'true-client-ip')).toBe(
      '9.9.9.9',
    );
  });

  it('takes the first address from a list', () => {
    const headers = { 'x-forwarded-for': ' 9.9.9.9 , 10.0.0.7, 10.0.0.8' };
    expect(clientIpOf(handshake(headers), 'x-forwarded-for')).toBe('9.9.9.9');
  });

  it('takes the first value when the header was sent twice', () => {
    const headers = { 'true-client-ip': ['9.9.9.9', '8.8.8.8'] };
    expect(clientIpOf(handshake(headers), 'true-client-ip')).toBe('9.9.9.9');
  });

  it.each([
    ['the header is missing', {}],
    ['the header is empty', { 'true-client-ip': '  ' }],
    ['the value is absurdly long', { 'true-client-ip': '9'.repeat(500) }],
  ])('returns null when %s', (_name, headers) => {
    expect(clientIpOf(handshake(headers), 'true-client-ip')).toBeNull();
  });
});
