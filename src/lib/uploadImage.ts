/**
 * uploadImage -- shared "pick a file, get back a public URL" helper
 * for guidebook image fields (editor body images, hero, card photos).
 *
 * Compresses client-side, uploads to the property-images bucket
 * (its storage policies already allow authenticated uploads) under a
 * guidebook-specific folder, and returns the public URL.
 */
import { supabase } from './supabase';
import { compressImageFile } from './compressImage';

const BUCKET = 'property-images';
const FOLDER = 'guidebook-body';

export async function uploadGuidebookImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`"${file.name}" is not an image`);
  }
  const compressed = await compressImageFile(file);
  const ext = (compressed.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${FOLDER}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, compressed, {
    cacheControl: '31536000',
    upsert: false,
    contentType: compressed.type,
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('no public URL returned');
  return data.publicUrl;
}
