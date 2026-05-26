/**
 * amenitiesCatalog — the live set of amenities currently used on
 * at least one published, non-archived property on the partner.
 *
 * The global search filter restricts itself to this catalog: a
 * user can only filter by amenities that actually appear on the
 * inventory. This keeps the typeahead useful (no dead-end terms
 * that match nothing) and prevents the team from inventing tags
 * that drift away from the property data.
 *
 * Amenities can be stored as JSONB arrays OR comma-separated
 * strings on partner_properties.amenity_tags — we accept both
 * shapes here, same as propertySearch does.
 *
 * Dedupe is case-insensitive on the lowered form, but the
 * returned label is the first casing we encounter on the wire
 * (so "Hot Tub" beats "hot tub" if both exist). Sorted alphabetically
 * by lowered form so the suggestion list reads cleanly.
 */
import { CT_RENTALS_PARTNER_ID } from '../pages/constants';

export interface AmenityCatalogEntry {
  /** Display label (preserves the first casing we saw). */
  label: string;
  /** Lower-cased label, used as the dedupe key + match key. */
  lower: string;
}

function normalizeTagsField(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof raw === 'string') {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

export async function fetchAmenityCatalog(supabase: any): Promise<AmenityCatalogEntry[]> {
  const { data, error } = await supabase
    .from('partner_properties')
    .select('amenity_tags, is_published, is_archived')
    .eq('partner_id', CT_RENTALS_PARTNER_ID)
    .eq('is_published', true);
  if (error) throw error;

  const byLower = new Map<string, string>();
  for (const row of (data || [])) {
    if (row.is_archived) continue;
    for (const tag of normalizeTagsField(row.amenity_tags)) {
      const lower = tag.toLowerCase();
      if (!byLower.has(lower)) byLower.set(lower, tag);
    }
  }
  return Array.from(byLower.entries())
    .map(([lower, label]) => ({ label, lower }))
    .sort((a, b) => a.lower.localeCompare(b.lower));
}

/** Case-insensitive membership test. */
export function catalogHas(catalog: AmenityCatalogEntry[], term: string): boolean {
  const lower = term.trim().toLowerCase();
  if (!lower) return false;
  return catalog.some(e => e.lower === lower);
}

/** Suggestion list for the typeahead — returns catalog entries
 *  whose label contains the (lower-cased) draft as a substring,
 *  ranked: prefix matches first, then substring matches. Caller
 *  decides head-limit (kept short in the UI to avoid a wall of
 *  chips). Returns the full catalog when the draft is empty. */
export function suggestAmenities(
  catalog: AmenityCatalogEntry[],
  draft: string,
  limit = 8,
): AmenityCatalogEntry[] {
  const q = draft.trim().toLowerCase();
  if (!q) return catalog.slice(0, limit);
  const prefix: AmenityCatalogEntry[] = [];
  const middle: AmenityCatalogEntry[] = [];
  for (const e of catalog) {
    if (e.lower.startsWith(q)) prefix.push(e);
    else if (e.lower.includes(q)) middle.push(e);
  }
  return [...prefix, ...middle].slice(0, limit);
}
