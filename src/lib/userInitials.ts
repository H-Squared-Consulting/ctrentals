/**
 * userInitials -- maps a signed-in user's email to a 2-letter tag
 * stamped on every enquiry they create. Surfaces as a small pill
 * on the bottom-right of each deal card so the team can see at a
 * glance who captured a lead, and feeds the "show only mine"
 * filter on the kanban toolbar.
 *
 * The mapping is intentionally local-part based (matches against
 * the prefix before @) so it survives domain changes — Nicki and
 * Hayley currently sit on @southernescapes.co.za but the family's
 * personal addresses also need to resolve.
 */

export type TeamInitials = 'NT' | 'HH' | 'JH' | 'GH';

/** Canonical display order: Nicki, Hayley, Jordon, Gary. */
export const TEAM_INITIALS: TeamInitials[] = ['NT', 'HH', 'JH', 'GH'];

export const INITIALS_TO_NAME: Record<TeamInitials, string> = {
  NT: 'Nicki',
  HH: 'Hayley',
  JH: 'Jordon',
  GH: 'Gary',
};

/** Match by local-part prefix so future email aliases keep working. */
const LOCAL_PART_PREFIXES: Array<{ prefix: string; initials: TeamInitials }> = [
  { prefix: 'nicki', initials: 'NT' },
  { prefix: 'hayley', initials: 'HH' },
  { prefix: 'jordon', initials: 'JH' },
  { prefix: 'gary', initials: 'GH' },
];

export function initialsForEmail(email: string | null | undefined): TeamInitials | null {
  if (!email) return null;
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  for (const { prefix, initials } of LOCAL_PART_PREFIXES) {
    if (local.startsWith(prefix)) return initials;
  }
  return null;
}
