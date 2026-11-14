import { describe, expect, it } from 'vitest';
import { relayOnlyRequested } from './peer.ts';

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
