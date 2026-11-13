import type { ClientId } from './types.ts';

/** The facts about a client that partner selection is allowed to use. */
export interface Candidate {
  readonly id: ClientId;
  /** Clients this one must never be paired with (for example, after "Report & skip"). */
  readonly avoid: ReadonlySet<ClientId>;
  /** The partner from this client's most recent session, if any. */
  readonly lastPartner: ClientId | null;
}

/**
 * Chooses a partner for `seeker` from the clients currently waiting.
 *
 * Rules, in order:
 * 1. Never the seeker themselves.
 * 2. Never someone either side is avoiding.
 * 3. First come, first served: `waiting` must be ordered oldest first.
 * 4. Prefer someone who was not the seeker's most recent partner. If the only eligible
 *    people waiting are recent partners, pick the oldest of them anyway, so two people
 *    alone on the site are not left waiting forever.
 *
 * This is a pure function (it reads its inputs and changes nothing), which makes it the
 * place to add interest-based matching later.
 */
export function findPartner(seeker: Candidate, waiting: Iterable<Candidate>): ClientId | null {
  let recentPartnerFallback: ClientId | null = null;

  for (const candidate of waiting) {
    if (candidate.id === seeker.id) continue;
    if (seeker.avoid.has(candidate.id) || candidate.avoid.has(seeker.id)) continue;

    const wereJustPaired =
      seeker.lastPartner === candidate.id || candidate.lastPartner === seeker.id;
    if (!wereJustPaired) return candidate.id;

    recentPartnerFallback ??= candidate.id;
  }

  return recentPartnerFallback;
}
