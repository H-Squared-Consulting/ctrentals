/**
 * agentRefCode -- short, unique-per-partner code for each booking
 * agent. Format: A{xx} where xx is the agent's initials (always two
 * uppercase letters). When two agents share the same initials we
 * append a numeric suffix (e.g. AHH, AHH2, AHH3).
 *
 * Surfaces as the first column on the Agents page (locked, never
 * editable post-creation) so an enquiry from "AHH" is unambiguously
 * Hayley Harrod even when there are two Hayleys on the books.
 *
 * Codes are generated client-side at agent INSERT and never auto-
 * recomputed on UPDATE — once an agent has a code, downstream
 * references (enquiry ref codes, proposal ref codes) lock to it.
 */

const PREFIX = 'A';

/** Two-letter initials from a free-text name. Falls back to padding
 *  with X so we always return exactly two upper-case letters:
 *    "Hayley Harrod"      → HH
 *    "Madonna"            → MA
 *    "Jean-Luc Picard"    → JP
 *    "" / null / "   "    → XX  (caller should normally validate name first)
 */
export function initialsFromName(name: string | null | undefined): string {
  const cleaned = (name || '').trim();
  if (!cleaned) return 'XX';
  // Split on whitespace AND hyphens so "Jean-Luc Picard" → JP not JLP.
  const tokens = cleaned.split(/[\s\-]+/).filter(Boolean);
  if (tokens.length >= 2) {
    return (tokens[0][0] + tokens[1][0]).toUpperCase();
  }
  // Single-token name — take first two letters of that word.
  const single = tokens[0];
  return (single.length >= 2 ? single.slice(0, 2) : single + 'X').toUpperCase();
}

/** Find the next free Axx (or AxxN) code given the names already
 *  in use. Pass the set of taken codes; returns the shortest free
 *  variant. */
export function nextAgentRefCode(name: string, taken: Set<string>): string {
  const initials = initialsFromName(name);
  const base = `${PREFIX}${initials}`;
  if (!taken.has(base)) return base;
  // Collision — append the smallest integer ≥ 2 that frees the code.
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Unreachable in practice (1000 agents sharing one pair of initials
  // is absurd) but better to fail loud than silently corrupt.
  throw new Error(`Couldn't find a free agent ref code starting with ${base}`);
}
