import { useState, FormEvent, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLayout } from '../contexts/LayoutContext';
import DateInput from '../components/DateInput';
import { CT_RENTALS_PARTNER_ID } from './constants';

export function EnquiryForm() {
  const { supabase } = useAuth();
  const { setPageTitle } = useLayout();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    client_name: '', client_email: '', client_phone: '',
    check_in: '', check_out: '',
    bedrooms_needed: 1, guests_total: 1, guests_adults: 1, guests_children: 0,
    nationality: '', budget_min: '', budget_max: '', notes: '',
  });

  useEffect(() => { setPageTitle('New Enquiry'); }, [setPageTitle]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null); setSuccess(false);

    const { error: insertError } = await supabase.from('enquiries').insert({
      partner_id: CT_RENTALS_PARTNER_ID,
      client_name: form.client_name,
      client_email: form.client_email || null,
      client_phone: form.client_phone || null,
      check_in: form.check_in,
      check_out: form.check_out,
      bedrooms_needed: Number(form.bedrooms_needed),
      guests_total: Number(form.guests_total),
      guests_adults: Number(form.guests_adults) || null,
      guests_children: Number(form.guests_children) || null,
      nationality: form.nationality || null,
      budget_min: form.budget_min ? Number(form.budget_min) : null,
      budget_max: form.budget_max ? Number(form.budget_max) : null,
      notes: form.notes || null,
    });

    if (insertError) {
      setError(insertError.message);
    } else {
      setSuccess(true);
      setForm({ client_name: '', client_email: '', client_phone: '', check_in: '', check_out: '', bedrooms_needed: 1, guests_total: 1, guests_adults: 1, guests_children: 0, nationality: '', budget_min: '', budget_max: '', notes: '' });
    }
    setLoading(false);
  }

  return (
    <div>
      <div className="form-container">
        <h2>New Enquiry</h2>
        {success && <div className="alert alert-success">Enquiry submitted successfully!</div>}
        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Client Name *</label>
              <input className="form-input" name="client_name" value={form.client_name} onChange={handleChange} required />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" name="client_email" type="email" value={form.client_email} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input className="form-input" name="client_phone" value={form.client_phone} onChange={handleChange} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Check In *</label>
              <DateInput className="form-input" value={form.check_in} onChange={(v) => setForm(prev => ({ ...prev, check_in: v }))} placeholder="e.g. 27 Mar 2026" />
            </div>
            <div className="form-group">
              <label className="form-label">Check Out *</label>
              <DateInput className="form-input" value={form.check_out} onChange={(v) => setForm(prev => ({ ...prev, check_out: v }))} placeholder="e.g. 3 Apr 2026" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Bedrooms Needed *</label>
              <input className="form-input" name="bedrooms_needed" type="number" min="1" value={form.bedrooms_needed} onChange={handleChange} required />
            </div>
            <div className="form-group">
              <label className="form-label">Guests Total *</label>
              <input className="form-input" name="guests_total" type="number" min="1" value={form.guests_total} onChange={handleChange} required />
            </div>
            <div className="form-group">
              <label className="form-label">Adults</label>
              <input className="form-input" name="guests_adults" type="number" min="0" value={form.guests_adults} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label className="form-label">Children</label>
              <input className="form-input" name="guests_children" type="number" min="0" value={form.guests_children} onChange={handleChange} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Nationality</label>
              <input className="form-input" name="nationality" value={form.nationality} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label className="form-label">Budget Min (ZAR)</label>
              <input className="form-input" name="budget_min" type="number" min="0" value={form.budget_min} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label className="form-label">Budget Max (ZAR)</label>
              <input className="form-input" name="budget_max" type="number" min="0" value={form.budget_max} onChange={handleChange} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-input" name="notes" rows={3} value={form.notes} onChange={handleChange} placeholder="Any additional details..." />
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Submitting...' : 'Submit Enquiry'}
          </button>
        </form>
      </div>
    </div>
  );
}
