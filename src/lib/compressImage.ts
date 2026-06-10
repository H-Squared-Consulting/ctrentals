/**
 * compressImage -- shared client-side image compression for uploads.
 *
 * Resizes a File in the browser via <canvas> so uploads stay small
 * (long edge capped, re-encoded as JPEG). Leaves non-raster files and
 * already-small images untouched. Same logic ImageManager and
 * GallerySectionsEditor inline today; new upload sites should import
 * this instead of copying it again.
 */

const MAX_DIM = 1920;      // long-edge pixel cap
const JPEG_QUALITY = 0.82; // visually lossless-ish for photos

export async function compressImageFile(file: File): Promise<File> {
  try {
    if (!file.type.startsWith('image/')) return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 600_000) return file;

    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), 'image/jpeg', JPEG_QUALITY)
    );
    if (!blob) return file;
    const baseName = file.name.replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch (err) {
    console.warn('[compressImage] compress failed, uploading original:', err);
    return file;
  }
}
