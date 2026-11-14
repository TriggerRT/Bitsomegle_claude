import { describe, expect, it } from 'vitest';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  chatSendSchema,
  mediaStateSchema,
  nextSchema,
  SDP_MAX_LENGTH,
  signalSchema,
} from '../src/index.ts';

const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('nextSchema', () => {
  it('accepts a session id', () => {
    expect(accepts(nextSchema, { sessionId: 'abc' })).toBe(true);
  });

  it.each([
    undefined,
    null,
    'abc',
    42,
    {},
    { sessionId: '' },
    { sessionId: 7 },
    { sessionId: 'x'.repeat(65) },
  ])('rejects %j', (value) => {
    expect(accepts(nextSchema, value)).toBe(false);
  });
});

describe('chatSendSchema', () => {
  it('accepts a normal message and trims surrounding whitespace', () => {
    const result = chatSendSchema.safeParse({ sessionId: 's', text: '  hello  ' });
    expect(result.success && result.data.text).toBe('hello');
  });

  it('accepts a message of exactly the maximum length', () => {
    const text = 'a'.repeat(CHAT_MESSAGE_MAX_LENGTH);
    expect(accepts(chatSendSchema, { sessionId: 's', text })).toBe(true);
  });

  it.each([
    ['empty text', { sessionId: 's', text: '' }],
    ['whitespace only', { sessionId: 's', text: '   \n ' }],
    ['too long', { sessionId: 's', text: 'a'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1) }],
    ['text is not a string', { sessionId: 's', text: { evil: true } }],
    ['missing text', { sessionId: 's' }],
    ['missing session id', { text: 'hi' }],
  ])('rejects %s', (_name, value) => {
    expect(accepts(chatSendSchema, value)).toBe(false);
  });

  it('removes fields that are not part of the contract', () => {
    const result = chatSendSchema.safeParse({ sessionId: 's', text: 'hi', to: 'someone-else' });
    expect(result.success && result.data).toEqual({ sessionId: 's', text: 'hi' });
  });
});

describe('mediaStateSchema', () => {
  it('accepts two booleans', () => {
    expect(accepts(mediaStateSchema, { sessionId: 's', audio: true, video: false })).toBe(true);
  });

  it('rejects non-boolean values', () => {
    expect(accepts(mediaStateSchema, { sessionId: 's', audio: 'yes', video: 1 })).toBe(false);
  });
});

describe('signalSchema', () => {
  it('accepts an offer', () => {
    const value = { sessionId: 's', description: { type: 'offer', sdp: 'v=0...' } };
    expect(accepts(signalSchema, value)).toBe(true);
  });

  it('accepts an ICE candidate, including the empty end-of-candidates marker', () => {
    const candidate = { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0' };
    expect(accepts(signalSchema, { sessionId: 's', candidate })).toBe(true);
    expect(accepts(signalSchema, { sessionId: 's', candidate: { candidate: '' } })).toBe(true);
  });

  it.each([
    ['neither description nor candidate', { sessionId: 's' }],
    ['unknown description type', { sessionId: 's', description: { type: 'hack', sdp: '' } }],
    [
      'oversized sdp',
      { sessionId: 's', description: { type: 'offer', sdp: 'x'.repeat(SDP_MAX_LENGTH + 1) } },
    ],
    ['candidate is a string', { sessionId: 's', candidate: 'candidate:1' }],
    ['missing session id', { description: { type: 'offer' } }],
  ])('rejects %s', (_name, value) => {
    expect(accepts(signalSchema, value)).toBe(false);
  });

  it('removes unknown fields before relaying', () => {
    const result = signalSchema.safeParse({
      sessionId: 's',
      description: { type: 'answer', sdp: 'v=0', extra: 'x' },
      target: 'another-user',
    });
    expect(result.success && result.data).toEqual({
      sessionId: 's',
      description: { type: 'answer', sdp: 'v=0' },
    });
  });
});
