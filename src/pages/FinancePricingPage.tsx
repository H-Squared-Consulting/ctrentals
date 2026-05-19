/**
 * FinancePricingPage -- Flat spreadsheet of every property × every season.
 *
 * Shows per-night rates side-by-side so the ladies can scan the portfolio
 * at a glance. Clicking a row opens the full PricingModal for that
 * property (the same calculator used everywhere else).
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { CT_RENTALS_PARTNER_ID, SEASON_TAG_OPTIONS } from './constants';
import PricingModal from './PricingModal';
import { fmtRand } from '../lib/pricingEngine';

interface Property {
  id: string;
  property_name: string;
  bedrooms: number | null;
  suburb: string | null;
}

interface Baseline {
  property_id: string;
  year: number;
  daily_rate: number;
}

interface SeasonTag {
  property_id: string | null;
  name: string;
  multiplier: number;
}

const SEASON_BG: Record<string, string> = {
  Peak: '#FEE2E2',
  High: '#FEF3C7',
  Mid:  '#D1FAE5',
  Low:  '#DBEAFE',
};

export default function FinancePricingPage() {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();
  const [properties, setProperties] = useState<Property[]>([]);
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [seasonTags, setSeasonTags] = useState<SeasonTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);

  const currentYear = new Date().getFullYear();

  useEffect(() => { setPageTitle('Pricing'); }, [setPageTitle]);

  useEffect(() => {
    if (!supabase) return;

    async function load() {
      setLoading(true);
      const [propRes, baseRes, tagRes] = await Promise.all([
        supabase
          .from('partner_properties')
          .select('id, property_name, bedrooms, suburb')
          .eq('partner_id', CT_RENTALS_PARTNER_ID)
          .order('property_name'),
        supabase
          .from('baselines')
          .select('property_id, year, daily_rate')
          .eq('year', currentYear),
        supabase
          .from('season_tags')
          .select('property_id, name, multiplier'),
      ]);
      if (propRes.data) setProperties(propRes.data as Property[]);
      if (baseRes.data) setBaselines(baseRes.data as Baseline[]);
      if (tagRes.data) setSeasonTags(tagRes.data as SeasonTag[]);
      setLoading(false);
    }
    load();
  }, [supabase, currentYear]);

  // Per-property baseline lookup.
  const baselineByProperty = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of baselines) map.set(b.property_id, Number(b.daily_rate));
    return map;
  }, [baselines]);

  // Per-property season multipliers. Property-specific overrides global.
  const multiplierFor = useMemo(() => {
    return (propertyId: string, seasonName: string): number => {
      const propTag = seasonTags.find(t => t.property_id === propertyId && t.name === seasonName);
      if (propTag) return Number(propTag.multiplier);
      const globalTag = seasonTags.find(t => t.property_id === null && t.name === seasonName);
      return globalTag ? Number(globalTag.multiplier) : 1;
    };
  }, [seasonTags]);

  if (loading) {
    return <div className="page-loader"><div className="spinner" /></div>;
  }

  return (
    <div>
      <div style={{ fontSize: '0.8125rem', color: 'var(--text-light)', marginBottom: '12px' }}>
        Per-night rates for {currentYear}. Click a row to open the full pricing calculator.
      </div>

      {properties.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-message">No properties yet.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Property</th>
                <th style={{ textAlign: 'right' }}>Base / night</th>
                {SEASON_TAG_OPTIONS.map((s) => (
                  <th key={s.value} style={{ textAlign: 'right', background: SEASON_BG[s.value] }}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => {
                const base = baselineByProperty.get(p.id);
                return (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedProperty(p)}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.property_name}</div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--text-light)' }}>
                        {p.bedrooms ? `${p.bedrooms} bed` : ''}{p.suburb ? ` · ${p.suburb}` : ''}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {base ? fmtRand(base) : <span style={{ color: 'var(--text-light)' }}>—</span>}
                    </td>
                    {SEASON_TAG_OPTIONS.map((s) => {
                      const mult = multiplierFor(p.id, s.value);
                      const seasonRate = base ? base * mult : null;
                      return (
                        <td key={s.value} style={{ textAlign: 'right' }}>
                          {seasonRate != null ? (
                            <>
                              <div>{fmtRand(seasonRate)}</div>
                              <div style={{ fontSize: '0.6875rem', color: 'var(--text-light)' }}>×{mult}</div>
                            </>
                          ) : (
                            <span style={{ color: 'var(--text-light)' }}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedProperty && (
        <PricingModal
          property={selectedProperty}
          supabase={supabase}
          onClose={() => setSelectedProperty(null)}
        />
      )}
    </div>
  );
}
