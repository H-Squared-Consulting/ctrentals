/* eslint-disable */
// @ts-nocheck
/**
 * CSVImportModal -- Bulk import properties from CSV
 * 4-step wizard: upload -> column mapping -> preview -> import
 */

import { useState, useRef } from 'react';

const DB_COLUMNS = [
  { value: '', label: '-- Skip --' },
  { value: 'property_name', label: 'Property Name' },
  { value: 'suburb', label: 'Suburb' },
  { value: 'city', label: 'City' },
  { value: 'province', label: 'Province' },
  { value: 'bedrooms', label: 'Bedrooms' },
  { value: 'bathrooms', label: 'Bathrooms' },
  { value: 'sleeps', label: 'Sleeps' },
  { value: 'description', label: 'Description' },
  { value: 'price_from', label: 'Price From' },
  { value: 'price_currency', label: 'Currency' },
  { value: 'booking_url', label: 'Booking URL' },
  { value: 'amenity_tags', label: 'Amenity Tags (semicolon-separated)' },
  { value: 'property_type', label: 'Property Type' },
  { value: 'tagline', label: 'Tagline' },
  { value: 'address_line1', label: 'Address Line 1' },
  { value: 'hero_image_url', label: 'Hero Image URL' },
  { value: 'owner_name', label: 'Owner Name' },
  { value: 'owner_email', label: 'Owner Email' },
  { value: 'owner_phone', label: 'Owner Phone' },
  { value: 'contact_email', label: 'Contact Email' },
  { value: 'contact_phone', label: 'Contact Phone' },
];

function generateSlug(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { headers: [], rows: [] };
  const parseLine = (line) => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
      else { current += char; }
    }
    values.push(current.trim());
    return values;
  };
  const headers = parseLine(lines[0]).map((h) => h.replace(/^"|"$/g, ''));
  const rows = lines.slice(1).filter((l) => l.trim()).map((line) => {
    const values = parseLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });
    return row;
  });
  return { headers, rows };
}

function autoMap(csvHeader) {
  const normalized = csvHeader.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const exact = DB_COLUMNS.find((c) => c.value === normalized);
  if (exact) return exact.value;
  const aliases = {
    name: 'property_name', property: 'property_name', property_name: 'property_name',
    suburb: 'suburb', area: 'suburb', city: 'city', town: 'city',
    bedrooms: 'bedrooms', beds: 'bedrooms', bathrooms: 'bathrooms', baths: 'bathrooms',
    sleeps: 'sleeps', guests: 'sleeps', pax: 'sleeps', description: 'description',
    price: 'price_from', price_from: 'price_from', rate: 'price_from',
    currency: 'price_currency', booking_url: 'booking_url', url: 'booking_url', link: 'booking_url',
    amenities: 'amenity_tags', amenity_tags: 'amenity_tags', tags: 'amenity_tags',
    type: 'property_type', property_type: 'property_type', tagline: 'tagline',
    address: 'address_line1', address_line1: 'address_line1',
    hero_image: 'hero_image_url', image: 'hero_image_url',
    owner: 'owner_name', owner_name: 'owner_name', owner_email: 'owner_email', owner_phone: 'owner_phone',
    province: 'province', contact_email: 'contact_email', contact_phone: 'contact_phone',
  };
  return aliases[normalized] || '';
}

export default function CSVImportModal({ partnerId, onClose, onSave, supabase, user }) {
  const fileRef = useRef(null);
  const [step, setStep] = useState('upload');
  const [dragOver, setDragOver] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRows, setCsvRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState(null);

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const { headers, rows } = parseCSV(text);
      if (headers.length === 0 || rows.length === 0) { alert('Could not parse CSV.'); return; }
      setCsvHeaders(headers);
      setCsvRows(rows);
      const autoMapping = {};
      headers.forEach((h) => { autoMapping[h] = autoMap(h); });
      setMapping(autoMapping);
      setStep('map');
    };
    reader.readAsText(file);
  }

  function handleDrop(e) {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) { handleFile(file); }
    else { alert('Please drop a .csv file'); }
  }

  function updateMapping(csvHeader, dbColumn) { setMapping({ ...mapping, [csvHeader]: dbColumn }); }
  function getPropertyNameColumn() { return Object.entries(mapping).find(([, db]) => db === 'property_name')?.[0]; }

  function getMappedRows() {
    return csvRows.map((row) => {
      const mapped = {};
      Object.entries(mapping).forEach(([csvHeader, dbCol]) => { if (dbCol) mapped[dbCol] = row[csvHeader]; });
      return mapped;
    });
  }

  function validateRows(rows) { return rows.map((row) => ({ ...row, _valid: !!row.property_name?.trim() })); }

  async function handleImport() {
    const mapped = getMappedRows();
    const validated = validateRows(mapped);
    const validRows = validated.filter((r) => r._valid);
    if (validRows.length === 0) { alert('No valid rows to import.'); return; }
    setImporting(true); setImportProgress(0);

    const toInsert = validRows.map((row) => ({
      partner_id: partnerId,
      property_name: row.property_name?.trim() || '',
      slug: generateSlug(row.property_name),
      suburb: row.suburb?.trim() || null, city: row.city?.trim() || null, province: row.province?.trim() || null,
      bedrooms: row.bedrooms ? parseInt(row.bedrooms, 10) || 0 : null,
      bathrooms: row.bathrooms ? parseInt(row.bathrooms, 10) || 0 : null,
      sleeps: row.sleeps ? parseInt(row.sleeps, 10) || 0 : null,
      description: row.description?.trim() || null,
      price_from: row.price_from ? parseFloat(row.price_from) || null : null,
      price_currency: row.price_currency?.trim() || 'ZAR',
      booking_url: row.booking_url?.trim() || null,
      amenity_tags: row.amenity_tags ? row.amenity_tags.split(';').map((t) => t.trim()).filter(Boolean) : [],
      property_type: row.property_type?.trim() || null,
      tagline: row.tagline?.trim() || null,
      address_line1: row.address_line1?.trim() || null,
      hero_image_url: row.hero_image_url?.trim() || null,
      owner_name: row.owner_name?.trim() || null, owner_email: row.owner_email?.trim() || null, owner_phone: row.owner_phone?.trim() || null,
      contact_email: row.contact_email?.trim() || null, contact_phone: row.contact_phone?.trim() || null,
      is_published: false, created_by: user?.id || null,
    }));

    const batchSize = 25;
    let successCount = 0, failCount = 0;
    const errors = [];
    for (let i = 0; i < toInsert.length; i += batchSize) {
      const batch = toInsert.slice(i, i + batchSize);
      const { data, error } = await supabase.from('partner_properties').insert(batch).select();
      if (error) { failCount += batch.length; errors.push(error.message); }
      else { successCount += (data || []).length; }
      setImportProgress(Math.min(i + batchSize, toInsert.length));
    }
    setImporting(false);
    setImportResult({ total: toInsert.length, success: successCount, failed: failCount, errors });
    setStep('done');
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Import Properties from CSV</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {step === 'upload' && (
            <div>
              <p style={{ color: '#6B7280', marginBottom: '1rem' }}>Upload a CSV file with property data. The first row should be column headers.</p>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                style={{ border: `2px dashed ${dragOver ? '#0F4C75' : '#d1d5db'}`, borderRadius: '8px', padding: '3rem 2rem', textAlign: 'center', cursor: 'pointer', background: dragOver ? '#f0f7ff' : '#fafafa', transition: 'all 0.2s' }}
              >
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📄</div>
                <p style={{ fontWeight: 500, marginBottom: '0.25rem' }}>Drop CSV file here or click to browse</p>
                <p style={{ fontSize: '0.875rem', color: '#9CA3AF' }}>Expected columns: property_name, suburb, city, bedrooms, sleeps, price_from, etc.</p>
              </div>
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => handleFile(e.target.files[0])} style={{ display: 'none' }} />
            </div>
          )}

          {step === 'map' && (
            <div>
              <p style={{ color: '#6B7280', marginBottom: '1rem' }}>Map CSV columns to database fields. Columns mapped to "Skip" will be ignored.</p>
              <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#f0fdf4', borderRadius: '6px', fontSize: '0.875rem' }}>
                Found <strong>{csvRows.length}</strong> rows with <strong>{csvHeaders.length}</strong> columns
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 24px 1fr', gap: '0.5rem', alignItems: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', color: '#6B7280' }}>CSV Column</div>
                <div />
                <div style={{ fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', color: '#6B7280' }}>Database Field</div>
                {csvHeaders.map((header) => (
                  <div key={header} style={{ display: 'contents' }}>
                    <div style={{ padding: '0.375rem 0.5rem', background: '#f3f4f6', borderRadius: '4px', fontSize: '0.875rem' }}>{header}</div>
                    <span style={{ textAlign: 'center', color: '#9CA3AF' }}>&rarr;</span>
                    <select className="form-input" value={mapping[header] || ''} onChange={(e) => updateMapping(header, e.target.value)} style={{ fontSize: '0.875rem' }}>
                      {DB_COLUMNS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                    </select>
                  </div>
                ))}
              </div>
              {!getPropertyNameColumn() && (
                <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#fef2f2', borderRadius: '6px', color: '#dc2626', fontSize: '0.875rem' }}>
                  Warning: No column is mapped to "Property Name". Every property needs a name.
                </div>
              )}
            </div>
          )}

          {step === 'preview' && (
            <div>
              <p style={{ color: '#6B7280', marginBottom: '1rem' }}>Preview the data to be imported. Red rows are missing a property name and will be skipped.</p>
              {(() => {
                const mapped = getMappedRows();
                const validated = validateRows(mapped);
                const validCount = validated.filter((r) => r._valid).length;
                const previewRows = validated.slice(0, 15);
                const dbCols = [...new Set(Object.values(mapping).filter(Boolean))];
                return (
                  <>
                    <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#f0fdf4', borderRadius: '6px', fontSize: '0.875rem' }}>
                      <strong>{validCount}</strong> of {validated.length} rows are valid and will be imported
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                        <thead><tr>
                          <th style={{ textAlign: 'left', padding: '0.375rem 0.5rem', borderBottom: '2px solid #e5e7eb', fontWeight: 600 }}>#</th>
                          {dbCols.map((col) => (<th key={col} style={{ textAlign: 'left', padding: '0.375rem 0.5rem', borderBottom: '2px solid #e5e7eb', fontWeight: 600 }}>{DB_COLUMNS.find((c) => c.value === col)?.label || col}</th>))}
                        </tr></thead>
                        <tbody>
                          {previewRows.map((row, i) => (
                            <tr key={i} style={{ background: row._valid ? 'transparent' : '#fef2f2' }}>
                              <td style={{ padding: '0.375rem 0.5rem', borderBottom: '1px solid #f3f4f6', color: '#9CA3AF' }}>{i + 1}</td>
                              {dbCols.map((col) => (<td key={col} style={{ padding: '0.375rem 0.5rem', borderBottom: '1px solid #f3f4f6', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row[col] || <span style={{ color: '#d1d5db' }}>-</span>}</td>))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {validated.length > 15 && <p style={{ marginTop: '0.5rem', color: '#9CA3AF', fontSize: '0.8125rem' }}>Showing first 15 of {validated.length} rows</p>}
                  </>
                );
              })()}
            </div>
          )}

          {step === 'preview' && importing && (
            <div style={{ marginTop: '1rem', padding: '1rem', background: '#f0f7ff', borderRadius: '6px' }}>
              <p style={{ fontWeight: 500, marginBottom: '0.5rem' }}>Importing {importProgress} of {getMappedRows().filter((r) => r.property_name?.trim()).length}...</p>
              <div style={{ height: '6px', background: '#e5e7eb', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(importProgress / Math.max(getMappedRows().filter((r) => r.property_name?.trim()).length, 1)) * 100}%`, background: '#0F4C75', transition: 'width 0.3s' }} />
              </div>
            </div>
          )}

          {step === 'done' && importResult && (
            <div>
              <div style={{ padding: '1.5rem', borderRadius: '8px', textAlign: 'center', background: importResult.failed === 0 ? '#f0fdf4' : '#fffbeb' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{importResult.failed === 0 ? '✅' : '⚠️'}</div>
                <p style={{ fontWeight: 600, fontSize: '1.125rem', marginBottom: '0.25rem' }}>Import Complete</p>
                <p style={{ color: '#6B7280' }}>
                  Successfully imported <strong>{importResult.success}</strong> properties.
                  {importResult.failed > 0 && <> <span style={{ color: '#dc2626' }}>{importResult.failed} failed.</span></>}
                </p>
                {importResult.errors.length > 0 && (
                  <div style={{ marginTop: '1rem', textAlign: 'left', padding: '0.75rem', background: '#fef2f2', borderRadius: '6px', fontSize: '0.8125rem', color: '#dc2626' }}>
                    {importResult.errors.map((err, i) => <p key={i}>{err}</p>)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <div style={{ flex: 1 }} />
          {step === 'upload' && <button className="btn btn-secondary" onClick={onClose}>Cancel</button>}
          {step === 'map' && (<><button className="btn btn-secondary" onClick={() => setStep('upload')}>Back</button><button className="btn btn-primary" onClick={() => setStep('preview')} disabled={!getPropertyNameColumn()}>Preview</button></>)}
          {step === 'preview' && (<><button className="btn btn-secondary" onClick={() => setStep('map')} disabled={importing}>Back</button><button className="btn btn-primary" onClick={handleImport} disabled={importing}>{importing ? 'Importing...' : 'Import'}</button></>)}
          {step === 'done' && <button className="btn btn-primary" onClick={onSave}>Done</button>}
        </div>
      </div>
    </div>
  );
}
