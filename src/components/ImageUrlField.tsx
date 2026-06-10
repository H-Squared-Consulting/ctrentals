/**
 * ImageUrlField -- image input used across the guidebook editor.
 *
 * One field, two ways in: Upload picks a local photo (compressed +
 * uploaded to Supabase Storage, URL filled in automatically) and the
 * text input still accepts a pasted URL for images hosted elsewhere.
 * Shows a live preview under the field whenever there's a value.
 */
import { useRef, useState } from 'react';
import { uploadGuidebookImage } from '../lib/uploadImage';

export default function ImageUrlField({
  id, label, value, onChange, hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (url: string) => void;
  hint?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickFile(file: File | undefined) {
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    try {
      onChange(await uploadGuidebookImage(file));
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
      <label className="form-label" htmlFor={id}>{label}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id={id}
          className="form-input"
          type="url"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="https://… or use Upload"
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{ flexShrink: 0 }}
        >
          {uploading ? 'Uploading…' : '⬆ Upload'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => pickFile(e.target.files?.[0])}
        />
      </div>
      {error && <div className="form-hint" style={{ color: 'var(--color-danger, #DC2626)' }}>Upload failed: {error}</div>}
      {hint && !error && <div className="form-hint">{hint}</div>}
      {value && (
        <div className="gb-editor-hero-preview" aria-hidden>
          <img src={value} alt="" />
        </div>
      )}
    </div>
  );
}
