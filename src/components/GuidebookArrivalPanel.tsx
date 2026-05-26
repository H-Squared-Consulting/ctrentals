/**
 * GuidebookArrivalPanel -- admin editor for the Arrival & WiFi section
 * of a guidebook. Lives inside GuidebookEditorPage.
 *
 * Fields:
 *   checkin_text     — TipTap prose
 *   directions_text  — TipTap prose (collapsed under the map on the guest page)
 *   parking_text     — TipTap prose
 *   wifi_ssid + wifi_password + wifi_notes
 *   checkout_text    — TipTap prose
 *   checkout_time    — HH:MM
 *   lat / lng        — used by the Mapbox embed in the Directions card
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from './ToastProvider';
import TipTapEditor from './TipTapEditor';

type Form = {
  checkin_text:    string;
  directions_text: string;
  parking_text:    string;
  wifi_ssid:       string;
  wifi_password:   string;
  wifi_notes:      string;
  checkout_text:   string;
  checkout_time:   string;       // 'HH:MM'
  lat:             string;       // numeric strings; converted on save
  lng:             string;
};

const EMPTY: Form = {
  checkin_text: '', directions_text: '', parking_text: '',
  wifi_ssid: '', wifi_password: '', wifi_notes: '',
  checkout_text: '', checkout_time: '', lat: '', lng: '',
};

function rowToForm(row: any): Form {
  return {
    checkin_text:    row.checkin_text    ?? '',
    directions_text: row.directions_text ?? '',
    parking_text:    row.parking_text    ?? '',
    wifi_ssid:       row.wifi_ssid       ?? '',
    wifi_password:   row.wifi_password   ?? '',
    wifi_notes:      row.wifi_notes      ?? '',
    checkout_text:   row.checkout_text   ?? '',
    checkout_time:   (row.checkout_time as string | null)?.slice(0, 5) ?? '',
    lat:             row.lat != null ? String(row.lat) : '',
    lng:             row.lng != null ? String(row.lng) : '',
  };
}

export default function GuidebookArrivalPanel({ guidebookId }: { guidebookId: string }) {
  const toast = useToast();
  const [original, setOriginal] = useState<Form>(EMPTY);
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('guidebooks')
        .select('checkin_text, directions_text, parking_text, wifi_ssid, wifi_password, wifi_notes, checkout_text, checkout_time, lat, lng')
        .eq('id', guidebookId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) { toast.error('Load failed: ' + (error?.message || 'not found')); setLoading(false); return; }
      const f = rowToForm(data);
      setOriginal(f); setForm(f);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidebookId]);

  const isDirty = useMemo(
    () => (Object.keys(form) as (keyof Form)[]).some(k => form[k] !== original[k]),
    [form, original],
  );

  function field<K extends keyof Form>(key: K, value: Form[K]) {
    setForm({ ...form, [key]: value });
  }

  async function handleSave() {
    if (saving) return;
    // Validate lat/lng if either is set — both should be numeric.
    const lat = form.lat.trim();
    const lng = form.lng.trim();
    if ((lat && isNaN(Number(lat))) || (lng && isNaN(Number(lng)))) {
      toast.error('Latitude and longitude must be numbers');
      return;
    }
    if ((lat && !lng) || (lng && !lat)) {
      toast.error('Set both latitude and longitude (or neither)');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('guidebooks')
      .update({
        checkin_text:    form.checkin_text    || null,
        directions_text: form.directions_text || null,
        parking_text:    form.parking_text    || null,
        wifi_ssid:       form.wifi_ssid.trim()     || null,
        wifi_password:   form.wifi_password.trim() || null,
        wifi_notes:      form.wifi_notes        || null,
        checkout_text:   form.checkout_text    || null,
        checkout_time:   form.checkout_time    || null,
        lat:             lat ? Number(lat) : null,
        lng:             lng ? Number(lng) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', guidebookId);
    setSaving(false);
    if (error) { toast.error('Save failed: ' + error.message); return; }
    setOriginal(form);
    toast.success('Saved');
  }

  if (loading) {
    return <div className="empty-state"><div className="empty-state-title">Loading…</div></div>;
  }

  return (
    <div className="gb-editor-section">
      <div className="gb-editor-section-head">
        <h2 className="gb-editor-section-title">Arrival & WiFi</h2>
        <p className="gb-editor-section-lede">
          Edits flow straight to the guest Arrival cards. Coordinates power the embedded map.
        </p>
      </div>

      <div className="form-grid-2">
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Check-in instructions</label>
          <TipTapEditor value={form.checkin_text} onChange={v => field('checkin_text', v)} />
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Directions (written)</label>
          <TipTapEditor value={form.directions_text} onChange={v => field('directions_text', v)} />
          <div className="form-hint">Shown as a "Written directions" collapse under the map on the guest page.</div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="gb-lat">Latitude</label>
          <input id="gb-lat" className="form-input" type="text" inputMode="decimal" value={form.lat}
                 onChange={e => field('lat', e.target.value)} placeholder="-34.0263" />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="gb-lng">Longitude</label>
          <input id="gb-lng" className="form-input" type="text" inputMode="decimal" value={form.lng}
                 onChange={e => field('lng', e.target.value)} placeholder="18.4377" />
          <div className="form-hint">Coordinates power the Directions map embed.</div>
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Parking</label>
          <TipTapEditor value={form.parking_text} onChange={v => field('parking_text', v)} />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="gb-ssid">WiFi network (SSID)</label>
          <input id="gb-ssid" className="form-input" type="text" value={form.wifi_ssid}
                 onChange={e => field('wifi_ssid', e.target.value)} placeholder="Montrose-Terrace-Guest" />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="gb-wpw">WiFi password</label>
          <input id="gb-wpw" className="form-input" type="text" value={form.wifi_password}
                 onChange={e => field('wifi_password', e.target.value)} placeholder="WelcomeHome2026" />
          <div className="form-hint">Guests will see this in plain text. The privacy gate ships in v2.</div>
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label" htmlFor="gb-wnotes">WiFi notes</label>
          <textarea id="gb-wnotes" className="form-input" value={form.wifi_notes} rows={2}
                    onChange={e => field('wifi_notes', e.target.value)} placeholder="Extra notes — e.g. router location, guest network only." />
        </div>

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Check-out instructions</label>
          <TipTapEditor value={form.checkout_text} onChange={v => field('checkout_text', v)} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="gb-cot">Check-out time</label>
          <input id="gb-cot" className="form-input" type="time" value={form.checkout_time}
                 onChange={e => field('checkout_time', e.target.value)} />
          <div className="form-hint">Shown on the Check-out quick-action chip ("Check-out 10am").</div>
        </div>
      </div>

      <div className="gb-mp-editor-actions">
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!isDirty || saving}>
          {saving ? 'Saving…' : isDirty ? 'Save changes' : 'Saved'}
        </button>
      </div>
    </div>
  );
}
