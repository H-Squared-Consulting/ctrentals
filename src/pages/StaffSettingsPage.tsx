/**
 * StaffSettingsPage — "My signature & bank details".
 *
 * Each team member edits the sign-off + bank blocks that the
 * management-phase email templates inject (`{{staff_signature}}`,
 * `{{bank_sa}}`, `{{bank_uk}}`, etc.). Rows are keyed by INITIALS
 * (NT/HH/JH/GH) — one person signs in from several addresses, and
 * `initialsForEmail()` collapses them onto a single staff row.
 *
 * Mirrors `ChannelDefaultsPage` (embedded prop, useAuth/useToast/
 * useLayout). Single form card, upsert on (partner_id, initials). If
 * the signed-in email maps to no team member, the form is replaced by
 * a notice and there is nothing to save.
 */

/* eslint-disable */
// @ts-nocheck

import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import { useToast } from '../components/ToastProvider';
import { CT_RENTALS_PARTNER_ID } from './constants';
import { initialsForEmail, INITIALS_TO_NAME } from '../lib/userInitials';

interface StaffForm {
  display_name: string;
  reply_email: string;
  reply_phone: string;
  signature: string;
  bank_sa: string;
  bank_uk: string;
}

const EMPTY: StaffForm = {
  display_name: '',
  reply_email: '',
  reply_phone: '',
  signature: '',
  bank_sa: '',
  bank_uk: '',
};

export default function StaffSettingsPage({ embedded }: { embedded?: boolean } = {}) {
  const { supabase, user } = useAuth();
  const { setPageTitle } = useLayout();
  const toast = useToast();

  // Collapse this user's email onto a team initials key. null => the
  // email isn't a recognised team member, so there's no row to edit.
  const initials = initialsForEmail(user?.email);

  const [form, setForm] = useState<StaffForm>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!embedded) setPageTitle('My signature'); }, [setPageTitle, embedded]);

  async function load() {
    if (!initials) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('staff_settings')
      .select('*')
      .eq('partner_id', CT_RENTALS_PARTNER_ID)
      .eq('initials', initials)
      .maybeSingle();
    if (data) {
      setForm({
        display_name: data.display_name || '',
        reply_email: data.reply_email || '',
        reply_phone: data.reply_phone || '',
        signature: data.signature || '',
        bank_sa: data.bank_sa || '',
        bank_uk: data.bank_uk || '',
      });
    } else {
      // Defaults when no row exists yet — name from the initials map.
      setForm({ ...EMPTY, display_name: INITIALS_TO_NAME[initials] || '' });
    }
    setLoading(false);
  }
  useEffect(() => { if (supabase) load(); }, [supabase, initials]);

  async function save() {
    if (!initials) return;
    setSaving(true);
    try {
      const payload = {
        partner_id: CT_RENTALS_PARTNER_ID,
        initials,
        display_name: form.display_name.trim() || INITIALS_TO_NAME[initials] || initials,
        reply_email: form.reply_email.trim().toLowerCase() || null,
        reply_phone: form.reply_phone.trim() || null,
        signature: form.signature.trim() || null,
        bank_sa: form.bank_sa.trim() || null,
        bank_uk: form.bank_uk.trim() || null,
        updated_at: new Date().toISOString(),
        updated_by: user?.email?.toLowerCase() ?? null,
      };
      const { error } = await supabase
        .from('staff_settings')
        .upsert(payload, { onConflict: 'partner_id,initials' });
      if (error) throw error;
      toast.success('Signature saved');
    } catch (err: any) {
      toast.error('Failed to save: ' + (err?.message || err));
    } finally {
      setSaving(false);
    }
  }

  // No team mapping for this email — nothing to edit. Show a clear
  // notice (dark, readable text) and disable saving entirely.
  if (initials === null) {
    return (
      <div className="card" style={{ padding: 20 }}>
        <p style={{ color: 'var(--text)', fontWeight: 500, margin: 0, lineHeight: 1.6 }}>
          Your sign-in email isn't linked to a team member, so there's no signature to edit here.
          Sign in with your usual Southern Escapes address (Nicki, Hayley, Jordon or Gary) to manage
          your signature and bank details.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
          Editing the sign-off &amp; bank details for{' '}
          <strong style={{ color: 'var(--text)' }}>{INITIALS_TO_NAME[initials]} ({initials})</strong>.
          These inject into the management emails you draft.
        </span>
      </div>

      <div className="card" style={{ padding: 20 }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-light)' }}>Loading…</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
              <div className="form-group">
                <label className="form-label">Display name</label>
                <input
                  className="form-input"
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  placeholder={INITIALS_TO_NAME[initials] || ''}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Reply email</label>
                <input
                  className="form-input"
                  type="email"
                  value={form.reply_email}
                  onChange={(e) => setForm({ ...form, reply_email: e.target.value })}
                  placeholder="you@southernescapes.co.za"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Reply phone</label>
                <input
                  className="form-input"
                  value={form.reply_phone}
                  onChange={(e) => setForm({ ...form, reply_phone: e.target.value })}
                  placeholder="+27 …"
                />
              </div>
            </div>

            <div className="form-group" style={{ marginTop: 14 }}>
              <label className="form-label">Signature</label>
              <textarea
                className="form-input"
                rows={5}
                value={form.signature}
                onChange={(e) => setForm({ ...form, signature: e.target.value })}
                placeholder={`Kind regards,\n${INITIALS_TO_NAME[initials] || ''}`}
                style={{ fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }}
              />
            </div>

            <div className="form-group" style={{ marginTop: 14 }}>
              <label className="form-label">SA bank details</label>
              <textarea
                className="form-input"
                rows={5}
                value={form.bank_sa}
                onChange={(e) => setForm({ ...form, bank_sa: e.target.value })}
                placeholder="Account name, bank, account number, branch code…"
                style={{ fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }}
              />
            </div>

            <div className="form-group" style={{ marginTop: 14 }}>
              <label className="form-label">UK bank details</label>
              <textarea
                className="form-input"
                rows={5}
                value={form.bank_uk}
                onChange={(e) => setForm({ ...form, bank_uk: e.target.value })}
                placeholder="Account name, sort code, account number…"
                style={{ fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
