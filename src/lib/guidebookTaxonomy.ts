/**
 * guidebookTaxonomy -- single source of truth for the fixed 8-category
 * house-manual enum from GUIDEBOOK_DESIGN_GUIDE §2.2.
 *
 * Both surfaces import from here:
 *   - Guest renderer groups manual cards by category in this exact order
 *     (`CATEGORY_ORDER`), skipping empty groups.
 *   - Admin editor enforces a non-null pick from this enum on every card
 *     ("category is required"). Hostfully's biggest IA failure was that
 *     `category` was nullable and every host left it null; we will not
 *     repeat that.
 *
 * The DB column stays open `text` so legacy seeds keep loading, but at
 * read time we map legacy strings → canonical via `toCanonicalCategory`.
 * The admin editor never writes anything outside this set.
 */

export const CATEGORY_ORDER = [
  'Safety',
  'Connectivity',
  'Appliances',
  'Access',
  'House Rules',
  'Outdoors',
  'Local Context',
  'Emergencies',
] as const;

export type GuidebookCategory = typeof CATEGORY_ORDER[number];

/** Per-category metadata for the guest renderer (default icon when a
 *  manual hasn't picked one, eyebrow label, etc.). */
export const CATEGORY_META: Record<GuidebookCategory, { icon: string; description: string }> = {
  'Safety':        { icon: 'shield',          description: 'Fire extinguisher, first-aid kit, alarms, security.' },
  'Connectivity':  { icon: 'wifi',            description: 'WiFi, mobile signal, smart-TV and AV logins.' },
  'Appliances':    { icon: 'washing-machine', description: 'Kitchen, laundry, HVAC and media equipment.' },
  'Access':        { icon: 'key',             description: 'Keys, gate remotes, alarm codes, lockboxes.' },
  'House Rules':   { icon: 'home',            description: 'Quiet hours, smoking, pets, occupancy.' },
  'Outdoors':      { icon: 'pool',            description: 'Pool, jacuzzi, braai, garden, outdoor lighting.' },
  'Local Context': { icon: 'sun',             description: 'Load-shedding, water restrictions, trash days.' },
  'Emergencies':   { icon: 'alert',           description: 'Hospitals, doctors, shut-offs, evacuation.' },
};

/** Legacy category strings that lived in earlier seed migrations,
 *  mapped to their canonical replacements. Renderer applies this on
 *  read so older guidebooks keep grouping correctly even before a
 *  category-normalisation migration runs. */
const LEGACY_MAP: Record<string, GuidebookCategory> = {
  'Utilities':       'Local Context',
  'Errands':         'Local Context',
  'Transport':       'Local Context',
  'Inside the home': 'Appliances',
  'Outside the home':'Outdoors',
  'Arrival':         'Access',
  'House rules':     'House Rules',
  'Care of the home':'House Rules',
};

export function toCanonicalCategory(raw: string | null | undefined): GuidebookCategory | null {
  if (!raw) return null;
  if ((CATEGORY_ORDER as readonly string[]).includes(raw)) return raw as GuidebookCategory;
  return LEGACY_MAP[raw] ?? null;
}

/** Group an array of items by canonical category, in the canonical
 *  order. Items without a recognisable category are dropped (admin
 *  validation prevents this on save). */
export function groupByCategory<T extends { category: string | null }>(items: T[]): Array<{ category: GuidebookCategory; items: T[] }> {
  const buckets = new Map<GuidebookCategory, T[]>();
  for (const item of items) {
    const cat = toCanonicalCategory(item.category);
    if (!cat) continue;
    if (!buckets.has(cat)) buckets.set(cat, []);
    buckets.get(cat)!.push(item);
  }
  return CATEGORY_ORDER
    .filter(c => buckets.has(c))
    .map(c => ({ category: c, items: buckets.get(c)! }));
}

/** Valid emergency_tag values used by the Emergency page synthesis.
 *  Open `text` in the DB; this is the canonical list for the picker. */
export const EMERGENCY_TAGS = [
  { value: '',                     label: 'None' },
  { value: 'gas-shut-off',         label: 'Gas shut-off' },
  { value: 'water-shut-off',       label: 'Water shut-off' },
  { value: 'electrical-shut-off',  label: 'Electrical shut-off' },
] as const;

/** Visual icon picker — the inline-SVG names the renderer knows about.
 *  Used by the admin editor's icon select. Mirrors src/lib/guidebookShared.tsx. */
export const ICON_OPTIONS = [
  { value: 'home', label: 'Home' },
  { value: 'key', label: 'Key' },
  { value: 'map', label: 'Map pin' },
  { value: 'car', label: 'Car' },
  { value: 'wifi', label: 'WiFi' },
  { value: 'clock', label: 'Clock' },
  { value: 'bolt', label: 'Lightning' },
  { value: 'shopping-cart', label: 'Shopping' },
  { value: 'washing-machine', label: 'Laundry' },
  { value: 'alert', label: 'Alert' },
  { value: 'sun', label: 'Sun' },
  { value: 'pool', label: 'Pool' },
  { value: 'phone', label: 'Phone' },
  { value: 'message', label: 'Message' },
  { value: 'shield', label: 'Shield' },
  { value: 'hospital', label: 'Hospital' },
  { value: 'gas', label: 'Gas' },
  { value: 'water', label: 'Water' },
] as const;
