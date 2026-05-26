/**
 * GuidebookEmergencyPanel -- admin editor for the Emergency section.
 *
 * Fields:
 *   armed_response_company / armed_response_phone
 *   nearest_hospital_name / phone / address
 *   nearest_hospital_lat / nearest_hospital_lng
 *
 * Shut-off photos live on individual manual cards (House Manual panel,
 * via emergency_tag); not edited here.
 *
 * National emergency numbers (10111 / 10177 / +27 86 12 12 300) are
 * hardcoded SA per §10.10 — no fields for them.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from './ToastProvider';

type Form = {
  armed_response_company:   string;
  armed_response_phone:     string;
  nearest_hospital_name:    string;
  nearest_hospital_phone:   string;
  nearest_hospital_address: string;
  nearest_hospital_lat:     string;
  nearest_hospital_lng:     string;
};

const EMPTY: Form = {
  armed_response_company: '', armed_response_phone: '',
  nearest_hospital_name: '', nearest_hospital_phone: '', nearest_hospital_address: '',
  nearest_hospital_lat: '', nearest_hospital_lng: '',
};

function rowToForm(row: any): Form {
  return {
    armed_response_company:   row.armed_response_company   ?? '',
    armed_response_phone:     row.armed_response_phone     ?? '',
    nearest_hospital_name:    row.nearest_hospital_name    ?? '',
    nearest_hospital_phone:   row.nearest_hospital_phone   ?? '',
    nearest_hospital_address: row.nearest_hospital_address ?? '',
    nearest_hospital_lat:     row.nearest_hospital_lat != null ? String(row.nearest_hospital_lat) : '',
    nearest_hospital_lng:     row.nearest_hospital_lng != null ? String(row.nearest_hospital_lng) : '',
  };
}

export default function GuidebookEmergencyPanel({ guidebookId }: { guidebookId: string }) {
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
        .select('armed_response_company, armed_response_phone, nearest_hospital_name, nearest_hospital_phone, nearest_hospital_address, nearest_hospital_lat, nearest_hospital_lng')
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
    const lat = form.nearest_hospital_lat.trim();
    const lng = form.nearest_hospital_lng.trim();
    if ((lat && isNaN(Number(lat))) || (lng && isNaN(Number(lng)))) {
      toast.error('Hospital latitude / longitude must be numbers');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('guidebooks')
      .update({
        armed_response_company:   form.armed_response_company.trim()   || null,
        armed_response_phone:     form.armed_response_phone.trim()     || null,
        nearest_hospital_name:    form.nearest_hospital_name.trim()    || null,
        nearest_hospital_phone:   form.nearest_hospital_phone.trim()   || null,
        nearest_hospital_address: form.nearest_hospital_address.trim() || null,
        nearest_hospital_lat:     lat ? Number(lat) : null,
        nearest_hospital_lng:     lng ? Number(lng) : null,
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
        <h2 className="gb-editor-section-title">Emergency</h2>
        <p className="gb-editor-section-lede">
          The Emergency page (<code>/g/:slug/emergency</code>) renders these alongside the SA national numbers
          (10111, 10177, 112) which are hardcoded.
        </p>
      </div>

      <div className="form-grid-2">
        <div className="form-group">
          <label className="form-label" htmlFor="gb-arc">Armed-response company</label>
          <input id="gb-arc" className="form-input" type="text" value={form.armed_response_company}
                 onChange={e => field('armed_response_company', e.target.value)} placeholder="ADT Security" />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="gb-arp">Armed-response phone</label>
          <input id="gb-arp" className="form-input" type="tel" value={form.armed_response_phone}
                 onChange={e => field('armed_response_phone', e.target.value)} placeholder="+27 21 712 4009" />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="gb-hn">Nearest hospital</label>
          <input id="gb-hn" className="form-input" type="text" value={form.nearest_hospital_name}
                 onChange={e => field('nearest_hospital_name', e.target.value)} placeholder="Constantiaberg Mediclinic" />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="gb-hp">Hospital phone</label>
          <input id="gb-hp" className="form-input" type="tel" value={form.nearest_hospital_phone}
                 onChange={e => field('nearest_hospital_phone', e.target.value)} placeholder="+27 21 799 2911" />
        </div>

        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label" htmlFor="gb-ha">Hospital address</label>
          <input id="gb-ha" className="form-input" type="text" value={form.nearest_hospital_address}
                 onChange={e => field('nearest_hospital_address', e.target.value)} placeholder="Burnham Rd, Plumstead, Cape Town" />
          <div className="form-hint">Used by the Navigate button on the Emergency page.</div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="gb-hlat">Hospital latitude</label>
          <input id="gb-hlat" className="form-input" type="text" inputMode="decimal"
                 value={form.nearest_hospital_lat}
                 onChange={e => field('nearest_hospital_lat', e.target.value)} placeholder="-34.0153" />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="gb-hlng">Hospital longitude</label>
          <input id="gb-hlng" className="form-input" type="text" inputMode="decimal"
                 value={form.nearest_hospital_lng}
                 onChange={e => field('nearest_hospital_lng', e.target.value)} placeholder="18.4733" />
          <div className="form-hint">Falls back to the address-based lookup if blank.</div>
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
