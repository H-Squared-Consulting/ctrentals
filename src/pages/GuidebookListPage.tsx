/**
 * GuidebookListPage -- admin list view of all guidebooks at /guidebooks.
 *
 * Standard list-page baseline (docs/DESIGN-SYSTEM.md):
 *   - Toolbar: search + count + "New guidebook" button
 *   - Table rows clickable -> /guidebooks/:id
 *   - "Preview" action opens /g/:slug in a new tab on the public host
 *
 * Scope here is intentionally narrow per GUIDEBOOK_DESIGN_GUIDE §8.2 —
 * read + navigate. Creating new guidebooks from scratch comes in PR #5
 * (the House Manual editor flow); for v1 every guidebook is seeded.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useLayout } from '../contexts/LayoutContext';

type GuidebookRow = {
  id: string;
  slug: string;
  property_name: string;
  is_published: boolean;
  updated_at: string;
  hero_image_url: string | null;
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  return `${mo}mo ago`;
}

export default function GuidebookListPage() {
  const navigate = useNavigate();
  const { setPageTitle } = useLayout();
  const [rows, setRows] = useState<GuidebookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => { setPageTitle('Guidebooks'); }, [setPageTitle]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('guidebooks')
        .select('id, slug, property_name, is_published, updated_at, hero_image_url')
        .order('updated_at', { ascending: false });
      if (cancelled) return;
      if (error) { console.error('GuidebookListPage load failed:', error); setRows([]); }
      else setRows((data || []) as GuidebookRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(r =>
      r.property_name.toLowerCase().includes(q) ||
      r.slug.toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <div>
      <div className="list-toolbar">
        <div className="list-toolbar-left">
          <div className="list-search">
            <span className="list-search-icon">🔍</span>
            <input
              type="text"
              placeholder="Search by property name or slug"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="list-search-clear" onClick={() => setSearch('')}>✕</button>
            )}
          </div>
          <div className="list-count">{filtered.length} {filtered.length === 1 ? 'guidebook' : 'guidebooks'}</div>
        </div>
      </div>

      {loading ? (
        <div className="empty-state"><div className="empty-state-title">Loading…</div></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📖</div>
          <div className="empty-state-title">No guidebooks yet</div>
          <div className="empty-state-description">
            {rows.length === 0
              ? 'Once a property has a guidebook seeded it will appear here.'
              : 'Try a different search term.'}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Property</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Last updated</th>
                <th style={{ width: 1 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr
                  key={r.id}
                  className="table-row-clickable"
                  onClick={() => navigate(`/guidebooks/${r.id}`)}
                >
                  <td>
                    <div className="gb-list-row-property">
                      {r.hero_image_url
                        ? <div className="gb-list-row-thumb" style={{ backgroundImage: `url(${r.hero_image_url})` }} aria-hidden />
                        : <div className="gb-list-row-thumb gb-list-row-thumb--blank" aria-hidden />}
                      <span className="gb-list-row-name">{r.property_name}</span>
                    </div>
                  </td>
                  <td><code className="gb-list-slug">/g/{r.slug}</code></td>
                  <td>
                    <span className={`status-badge ${r.is_published ? 'status-badge--success' : 'status-badge--warning'}`}>
                      {r.is_published ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-light)' }}>{relativeTime(r.updated_at)}</td>
                  <td style={{ whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                    <div className="gb-list-actions">
                      <a
                        className="btn btn-ghost"
                        href={`/g/${r.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Preview as a guest"
                      >
                        Preview
                      </a>
                      <button
                        className="btn btn-outline"
                        type="button"
                        onClick={() => navigate(`/guidebooks/${r.id}`)}
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
