import { describe, expect, it } from 'vitest';
import { APP_NAME, CHAT_MESSAGE_MAX_LENGTH } from '../src/index.ts';

describe('shared constants', () => {
  it('exposes the app name', () => {
    expect(APP_NAME).toBe('Bitsomeggle');
  });

  it('has a positive chat length limit', () => {
    expect(CHAT_MESSAGE_MAX_LENGTH).toBeGreaterThan(0);
  });
});
