/**
 * GuidebookEmergencyPage -- public emergency page at /g/:slug/emergency.
 *
 * Built per GUIDEBOOK_DESIGN_GUIDE §4.6. The single most important page
 * in the whole guidebook: a panicked guest at 11pm reaches a real human
 * or shuts off the gas in one tap.
 *
 * Auto-synthesised from:
 *   - National emergency numbers (SA hardcoded — see §10.10)
 *   - guidebooks.host_phone (Call / WhatsApp)
 *   - guidebooks.nearest_hospital_* (Call / Navigate)
 *   - guidebooks.armed_response_company + armed_response_phone (Call)
 *   - Manual cards tagged with emergency_tag ∈
 *     { 'gas-shut-off', 'water-shut-off', 'electrical-shut-off' }
 *
 * Per §4.6: even with no host data the page renders the SA national
 * numbers — it never blocks. Per §10.8 no backup-host section.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  Icon,
  Emoji,
  GuidebookChrome,
  telHref,
  waHref,
  type Guidebook,
  type Manual,
} from '../lib/guidebookShared';

// Per Nicki (Southern Escapes) the national lines (10111/10177) are not
// useful for guests — the page leads with SE's own contacts instead:
// host → hospital → armed response → in-home shut-offs.

const SHUT_OFF_TAGS = ['gas-shut-off', 'water-shut-off', 'electrical-shut-off'] as const;
const SHUT_OFF_META: Record<string, { title: string; icon: string }> = {
  'gas-shut-off':        { title: 'Gas',         icon: 'gas' },
  'water-shut-off':      { title: 'Water',       icon: 'water' },
  'electrical-shut-off': { title: 'Electricity', icon: 'bolt' },
};

export default function GuidebookEmergencyPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [guidebook, setGuidebook] = useState<Guidebook | null>(null);
  const [shutOffs, setShutOffs] = useState<Manual[]>([]);

  useEffect(() => {
    if (guidebook) document.title = `Emergency · ${guidebook.property_name}`;
  }, [guidebook]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setNotFound(false);
      const { data: gb, error } = await supabase
        .from('guidebooks').select('*').eq('slug', slug).maybeSingle();
      if (cancelled) return;
      if (error || !gb) { setNotFound(true); setLoading(false); return; }
      setGuidebook(gb as Guidebook);

      // Pull just the shut-off manuals attached to this guidebook.
      const { data: rows } = await supabase
        .from('guidebook_manual_assignments')
        .select('position, override_body_html, guidebook_house_manuals(id, slug, title, category, body_html, icon, image_url, emergency_tag)')
        .eq('guidebook_id', gb.id)
        .order('position');
      if (cancelled) return;
      const mapped: Manual[] = (rows || []).map((row: any) => ({
        id: row.guidebook_house_manuals.id,
        slug: row.guidebook_house_manuals.slug,
        title: row.guidebook_house_manuals.title,
        category: row.guidebook_house_manuals.category,
        body_html: row.override_body_html ?? row.guidebook_house_manuals.body_html,
        icon: row.guidebook_house_manuals.icon,
        image_url: row.guidebook_house_manuals.image_url ?? null,
        emergency_tag: row.guidebook_house_manuals.emergency_tag ?? null,
        position: row.position,
      }));
      setShutOffs(mapped.filter(m => m.emergency_tag && SHUT_OFF_TAGS.includes(m.emergency_tag as any)));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) {
    return (
      <div className="gb-page gb-loading-wrap">
        <div className="gb-loading-spinner" />
        <div className="gb-loading-text">Loading emergency contacts</div>
      </div>
    );
  }
  if (notFound || !guidebook) {
    return (
      <div className="gb-page gb-loading-wrap">
        <div className="gb-loading-text">Guidebook not found.</div>
      </div>
    );
  }

  const hostTel = telHref(guidebook.host_phone);
  const hostWa  = waHref(guidebook.host_phone);
  const armedTel = telHref(guidebook.armed_response_phone);
  const hospitalTel = telHref(guidebook.nearest_hospital_phone);
  const hospitalNavHref = guidebook.nearest_hospital_address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(guidebook.nearest_hospital_address)}`
    : (guidebook.nearest_hospital_lat != null && guidebook.nearest_hospital_lng != null
        ? `https://www.google.com/maps/search/?api=1&query=${guidebook.nearest_hospital_lat},${guidebook.nearest_hospital_lng}`
        : null);

  const hostFirstName = (guidebook.host_name || '').split(' ')[0] || guidebook.host_name || '';

  return (
    <div className="gb-page gb-emergency-page">
      <header className="gb-emergency-header">
        <Link to={`/g/${guidebook.slug}`} className="gb-emergency-back" aria-label="Back to guidebook">
          <Icon name="arrow-left" /> <span>Back</span>
        </Link>
        <h1 className="gb-emergency-title">Emergency</h1>
        <p className="gb-emergency-lede">
          One tap reaches a real person who can help, fast.
        </p>
      </header>

      <main className="gb-emergency-main">
        {/* ── Call your host (lead) ──────────────────────────────── */}
        <section className="gb-emergency-block gb-emergency-block--critical">
          <div className="gb-emergency-block-head">
            <div className="gb-emergency-block-eyebrow">Call your host</div>
            <h2 className="gb-emergency-block-title">{hostFirstName ? `${hostFirstName} can help fast` : 'Your host'}</h2>
          </div>
          {hostTel || hostWa ? (
            <div className="gb-emergency-actions">
              {hostTel && (
                <a className="btn btn-tel gb-emergency-btn-big" href={hostTel} aria-label={`Call ${hostFirstName}`}>
                  <Icon name="phone" /> <span>Call {hostFirstName || 'host'}</span>
                </a>
              )}
              {hostWa && (
                <a className="btn btn-whatsapp gb-emergency-btn-big" href={hostWa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${hostFirstName}`}>
                  <Icon name="message" /> <span>WhatsApp {hostFirstName || 'host'}</span>
                </a>
              )}
            </div>
          ) : (
            <p className="gb-emergency-block-empty">
              Your host hasn't added a phone number yet — please check your booking confirmation for a contact.
            </p>
          )}
        </section>

        {/* ── Nearest hospital ──────────────────────────────────── */}
        {guidebook.nearest_hospital_name && (
          <section className="gb-emergency-block">
            <div className="gb-emergency-block-head">
              <div className="gb-emergency-block-eyebrow">Nearest hospital</div>
              <h2 className="gb-emergency-block-title">{guidebook.nearest_hospital_name}</h2>
              {guidebook.nearest_hospital_address && (
                <p className="gb-emergency-block-sub">{guidebook.nearest_hospital_address}</p>
              )}
            </div>
            <div className="gb-emergency-actions">
              {hospitalTel && (
                <a className="btn btn-tel" href={hospitalTel} aria-label={`Call ${guidebook.nearest_hospital_name}`}>
                  <Icon name="phone" /> <span>Call hospital</span>
                </a>
              )}
              {hospitalNavHref && (
                <a className="btn btn-outline-primary" href={hospitalNavHref} target="_blank" rel="noopener noreferrer" aria-label="Navigate to hospital in Maps">
                  <Icon name="map" /> <span>Navigate</span>
                </a>
              )}
            </div>
          </section>
        )}

        {/* ── Armed response ───────────────────────────────────── */}
        {guidebook.armed_response_company && (
          <section className="gb-emergency-block">
            <div className="gb-emergency-block-head">
              <div className="gb-emergency-block-eyebrow">Armed response</div>
              <h2 className="gb-emergency-block-title">{guidebook.armed_response_company}</h2>
            </div>
            {armedTel ? (
              <div className="gb-emergency-actions">
                <a className="btn btn-tel" href={armedTel} aria-label={`Call ${guidebook.armed_response_company}`}>
                  <Icon name="phone" /> <span>Call {guidebook.armed_response_company}</span>
                </a>
              </div>
            ) : (
              <p className="gb-emergency-block-empty">Phone number not yet set.</p>
            )}
          </section>
        )}

        {/* ── Shut-offs (gas / water / electrical) ─────────────── */}
        {shutOffs.length > 0 && (
          <section className="gb-emergency-block">
            <div className="gb-emergency-block-head">
              <div className="gb-emergency-block-eyebrow">Shut-offs (in the home)</div>
              <h2 className="gb-emergency-block-title">If something is leaking, sparking or hissing</h2>
            </div>
            <div className="gb-shutoff-list">
              {shutOffs.map(m => {
                const meta = m.emergency_tag ? SHUT_OFF_META[m.emergency_tag] : null;
                return (
                  <article key={m.id} className="gb-shutoff-card">
                    {m.image_url ? (
                      <div className="gb-shutoff-photo" style={{ backgroundImage: `url(${m.image_url})` }} aria-hidden />
                    ) : (
                      <div className="gb-shutoff-photo gb-shutoff-photo--placeholder" aria-hidden>
                        <Emoji name={meta?.icon || 'home'} />
                      </div>
                    )}
                    <div className="gb-shutoff-body">
                      <div className="gb-shutoff-eyebrow">{meta?.title || m.title}</div>
                      <h3 className="gb-shutoff-title">{m.title}</h3>
                      {m.body_html && (
                        <div className="gb-prose" dangerouslySetInnerHTML={{ __html: m.body_html }} />
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </main>

      {/* Chrome: host chip + ⌘K search. The shut-off manuals are fed
          to the search index so a guest looking for "gas" on the
          emergency page can still find the right card. */}
      <GuidebookChrome
        guidebook={guidebook}
        searchData={{ guidebook, manuals: shutOffs, recommendations: [] }}
      />
    </div>
  );
}
