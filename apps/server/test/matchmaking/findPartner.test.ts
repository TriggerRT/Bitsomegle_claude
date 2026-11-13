import { describe, expect, it } from 'vitest';
import { type Candidate, findPartner } from '../../src/matchmaking/findPartner.ts';

function candidate(
  id: string,
  extra: { avoid?: string[]; lastPartner?: string | null } = {},
): Candidate {
  return { id, avoid: new Set(extra.avoid ?? []), lastPartner: extra.lastPartner ?? null };
}

describe('findPartner', () => {
  it('returns null when nobody is waiting', () => {
    expect(findPartner(candidate('me'), [])).toBeNull();
  });

  it('picks the client who has waited longest', () => {
    const waiting = [candidate('first'), candidate('second'), candidate('third')];
    expect(findPartner(candidate('me'), waiting)).toBe('first');
  });

  it('never picks the seeker themselves', () => {
    expect(findPartner(candidate('me'), [candidate('me')])).toBeNull();
    expect(findPartner(candidate('me'), [candidate('me'), candidate('other')])).toBe('other');
  });

  it('skips someone the seeker is avoiding', () => {
    const seeker = candidate('me', { avoid: ['blocked'] });
    expect(findPartner(seeker, [candidate('blocked'), candidate('ok')])).toBe('ok');
    expect(findPartner(seeker, [candidate('blocked')])).toBeNull();
  });

  it('skips someone who is avoiding the seeker', () => {
    const waiting = [candidate('hater', { avoid: ['me'] }), candidate('ok')];
    expect(findPartner(candidate('me'), waiting)).toBe('ok');
  });

  it("prefers someone who was not the seeker's last partner", () => {
    const seeker = candidate('me', { lastPartner: 'ex' });
    expect(findPartner(seeker, [candidate('ex'), candidate('new')])).toBe('new');
  });

  it('treats "last partner" as mutual', () => {
    const waiting = [candidate('ex', { lastPartner: 'me' }), candidate('new')];
    expect(findPartner(candidate('me'), waiting)).toBe('new');
  });

  it('falls back to the last partner when nobody else is eligible', () => {
    const seeker = candidate('me', { lastPartner: 'ex', avoid: ['blocked'] });
    expect(findPartner(seeker, [candidate('blocked'), candidate('ex')])).toBe('ex');
  });

  it('never falls back to someone being avoided, even if they were the last partner', () => {
    const seeker = candidate('me', { lastPartner: 'ex', avoid: ['ex'] });
    expect(findPartner(seeker, [candidate('ex')])).toBeNull();
  });
});
