# OG Image Storage Plugin

Renders **PNG Open Graph share cards** for each processed photo. Gallery thumbnails stay **WebP** (display only) — this plugin does **not** store a second thumbnail format.

## Dual pipeline (best practice)

| Asset | Format | Path | Purpose |
| --- | --- | --- | --- |
| Gallery thumb | WebP | `/thumbnails/{id}.webp` | In-app grids / placeholders |
| Share card | PNG 1200×628 | `/og/{id}.png` (local) and/or remote storage | `og:image`, Share modal, crawlers |

Composition uses the WebP thumb **in memory** (decoded via sharp → JPEG data URL for Satori). That intermediate is **not** written to disk.

Social crawlers (X, LinkedIn, Slack, Discord, iMessage, Bluesky, Mastodon, …) receive the **PNG card**, not the WebP thumb.

## Examples

### Static / Cloudflare Pages (recommended)

```ts
import { defineBuilderConfig, ogImagePlugin } from '@afilmory/builder'

export default defineBuilderConfig(() => ({
  storage: { /* … */ },
  plugins: [
    ogImagePlugin({
      localPublic: true, // apps/web/public/og/{id}.png → /og/{id}.png
      uploadRemote: false, // skip remote upload when hosting OG on the same site
      vendor: {
        type: 'cloudflare-middleware',
        mode: 'local', // rewrite photo-page meta to {site}/og/{id}.png
      },
    }),
  ],
}))
```

Then:

```bash
pnpm run build:manifest -- --force-manifest   # generate PNG cards + manifest.ogImageUrl
pnpm --filter @afilmory/web deploy:cloudflare
```

### Remote storage + CDN

```ts
ogImagePlugin({
  localPublic: true,
  uploadRemote: true, // also upload to `.afilmory/og-images/{id}.png` on storage
  vendor: {
    type: 'cloudflare-middleware',
    mode: 'remote',
    storageURL: 'https://cdn.example.com',
  },
})
```

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `enable` | `true` | Master switch |
| `localPublic` | `true` | Write `apps/web/public/og/{id}.png` and set `item.ogImageUrl` to `/og/{id}.png` |
| `uploadRemote` | `true` | Upload PNG to storage under `directory` |
| `directory` | `.afilmory/og-images` | Remote key prefix |
| `storageConfig` | builder storage | Optional override storage for uploads |
| `contentType` | `image/png` | Upload MIME type |
| `siteName` / `accentColor` | from `config.json` | Branding on the card |
| `siteConfigPath` | `config.json` | Site JSON path |
| `vendor` | — | Optional post-build automation |

### Cloudflare middleware vendor

```ts
vendor: {
  type: 'cloudflare-middleware',
  mode: 'local' | 'remote', // default: local if storageURL omitted / localPublic
  storageURL?: string,      // required for mode: 'remote'
  siteConfigPath?: string,
}
```

Writes `_middleware.ts` to:

- `apps/web/functions/` (used when deploying with `apps/web/wrangler.jsonc`)
- `functions/` (repo root, for root-level deploys)

On `/photos/{id}` HTML responses it rewrites `og:image` / `twitter:image` to the photo’s PNG card.

## Dynamic backends (core / SSR)

When `be/apps/core` serves the gallery, `/og/{id}` still generates a **PNG** on demand from the WebP thumb (no extension rewrite). Prebuilt `ogImageUrl` is preferred in meta tags and the Share modal when present.

## Notes

- Force regenerate: `pnpm run build:manifest -- --force-manifest`
- Fonts load from `be/apps/core/src/modules/content/og/assets`; missing fonts skip rendering for that run
- Eagle provider: remote upload is disabled; use `localPublic: true`
