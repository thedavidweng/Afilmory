import type { PhotoManifest } from '~/types/photo'

/**
 * Resolve the share-card URL for a photo.
 * - Manifest `ogImageUrl` when the builder wrote a PNG card
 * - Dynamic API `/og/{id}` (backend / SSR)
 * - Static file `/og/{id}.png` is handled as an img onError fallback in the UI
 */
export function resolveOgPreviewUrl(photo: Pick<PhotoManifest, 'id' | 'ogImageUrl'>, baseUrl = ''): string {
  const join = (path: string) => {
    if (/^https?:\/\//i.test(path)) {
      return path
    }
    if (!baseUrl) {
      return path
    }
    return `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
  }

  if (photo.ogImageUrl) {
    return join(photo.ogImageUrl)
  }

  // Dynamic OG route (core/SSR) — returns image/png
  return join(`/og/${photo.id}`)
}
