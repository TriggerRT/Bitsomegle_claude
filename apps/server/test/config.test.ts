import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  it('defaults to port 3001 when PORT is not set', () => {
    expect(loadConfig({}).port).toBe(3001);
  });

  it('reads PORT from the environment', () => {
    expect(loadConfig({ PORT: '8080' }).port).toBe(8080);
  });

  it.each(['abc', '-1', '70000', '3.5'])('rejects invalid PORT %s', (value) => {
    expect(() => loadConfig({ PORT: value })).toThrow(/Invalid PORT/);
  });
});
