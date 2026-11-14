import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('loadConfig', () => {
  it('has safe defaults for local development', () => {
    expect(loadConfig({})).toEqual({
      port: 3001,
      corsOrigins: ['http://localhost:5173'],
      openWindows: [],
      maxClients: 1000,
      logLevel: 'info',
    });
  });

  describe('PORT', () => {
    it('is read from the environment', () => {
      expect(loadConfig({ PORT: '8080' }).port).toBe(8080);
    });

    it.each(['abc', '-1', '70000', '3.5'])('rejects %s', (value) => {
      expect(() => loadConfig({ PORT: value })).toThrow(/Invalid PORT/);
    });
  });

  describe('CORS_ORIGIN', () => {
    it('accepts one or several origins', () => {
      const config = loadConfig({
        CORS_ORIGIN: 'https://bitsomeggle.vercel.app, http://localhost:5173',
      });
      expect(config.corsOrigins).toEqual([
        'https://bitsomeggle.vercel.app',
        'http://localhost:5173',
      ]);
    });

    it('must be set in production', () => {
      expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/CORS_ORIGIN must be set/);
    });

    it.each([
      ['a wildcard', '*'],
      ['a bare hostname', 'bitsomeggle.vercel.app'],
      ['a trailing slash', 'https://bitsomeggle.vercel.app/'],
      ['a path', 'https://bitsomeggle.vercel.app/chat'],
    ])('rejects %s', (_name, value) => {
      expect(() => loadConfig({ CORS_ORIGIN: value })).toThrow(/Invalid CORS_ORIGIN/);
    });
  });

  describe('OPEN_WINDOWS', () => {
    it('is parsed into windows', () => {
      expect(loadConfig({ OPEN_WINDOWS: '21:00-00:30' }).openWindows).toHaveLength(1);
    });

    it('rejects a malformed value at startup', () => {
      expect(() => loadConfig({ OPEN_WINDOWS: 'evening' })).toThrow(/Invalid OPEN_WINDOWS/);
    });
  });

  describe('MAX_CLIENTS', () => {
    it('is read from the environment', () => {
      expect(loadConfig({ MAX_CLIENTS: '250' }).maxClients).toBe(250);
    });

    it.each(['0', '-5', 'lots'])('rejects %s', (value) => {
      expect(() => loadConfig({ MAX_CLIENTS: value })).toThrow(/Invalid MAX_CLIENTS/);
    });
  });

  describe('LOG_LEVEL', () => {
    it('is read from the environment', () => {
      expect(loadConfig({ LOG_LEVEL: 'debug' }).logLevel).toBe('debug');
    });

    it('rejects an unknown level', () => {
      expect(() => loadConfig({ LOG_LEVEL: 'chatty' })).toThrow(/Invalid LOG_LEVEL/);
    });
  });
});
