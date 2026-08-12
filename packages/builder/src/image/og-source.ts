import type { Buffer } from 'node:buffer'

import sharp from 'sharp'

/**
 * Convert a thumbnail (or any image) buffer into a Satori-safe data URL.
 *
 * Display thumbs may be WebP/AVIF; social OG cards are always rendered as PNG by
 * `@afilmory/og-renderer`. Satori embeds the source as a raster data URL — JPEG is
 * the most reliable intermediate format across resvg/Satori versions.
 *
 * This keeps the dual-pipeline model:
 * - gallery thumbs: WebP (or whatever the builder emits)
 * - share cards: PNG output, with JPEG intermediates for composition only (not stored as a second thumb)
 */
export async function toSatoriImageDataUrl(buffer: Buffer, sourceContentType?: string | null): Promise<string> {
  const normalized = (sourceContentType ?? '').toLowerCase().split(';')[0]?.trim()

  // PNG/JPEG can be embedded as-is (smaller work, no re-encode).
  if (normalized === 'image/jpeg' || normalized === 'image/jpg' || normalized === 'image/png') {
    return `data:${normalized === 'image/jpg' ? 'image/jpeg' : normalized};base64,${buffer.toString('base64')}`
  }

  // WebP/AVIF/unknown: re-encode to JPEG for Satori reliability.
  const jpeg = await sharp(buffer).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`
}

export function guessImageContentType(urlOrPath: string, fallback = 'image/jpeg'): string {
  const lowered = urlOrPath.toLowerCase()
  if (lowered.endsWith('.png')) {
    return 'image/png'
  }
  if (lowered.endsWith('.webp')) {
    return 'image/webp'
  }
  if (lowered.endsWith('.avif')) {
    return 'image/avif'
  }
  if (lowered.endsWith('.gif')) {
    return 'image/gif'
  }
  if (lowered.endsWith('.jpg') || lowered.endsWith('.jpeg')) {
    return 'image/jpeg'
  }
  return fallback
}
