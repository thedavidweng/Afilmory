import { Buffer } from 'node:buffer'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ExifInfo } from '@afilmory/og-renderer'
import { renderOgImage } from '@afilmory/og-renderer'
import type { PhotoManifestItem } from '@afilmory/typing'
import type { SatoriOptions } from 'satori'

import { guessImageContentType, toSatoriImageDataUrl } from '../../image/og-source.js'
import type { Logger } from '../../logger/index.js'
import { workdir } from '../../path.js'
import { StorageManager } from '../../storage/index.js'
import type { S3CompatibleConfig, StorageConfig } from '../../storage/interfaces.js'
import type { ThumbnailPluginData } from '../thumbnail-storage/shared.js'
import { THUMBNAIL_PLUGIN_DATA_KEY } from '../thumbnail-storage/shared.js'
import type { BuilderPlugin } from '../types.js'
import type { CloudflareMiddlewareVendorConfig } from './vendors/cloudflare-moddleware.js'
import { CloudflareMiddlewareVendor } from './vendors/cloudflare-moddleware.js'
import type { OgVendor } from './vendors/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../../../..')
const ogAssetsDir = path.join(repoRoot, 'be/apps/core/src/modules/content/og/assets')

const PLUGIN_NAME = 'afilmory:og-image'
const RUN_STATE_KEY = 'state'
const DEFAULT_DIRECTORY = '.afilmory/og-images'
/** Static SPA public path for share cards (same origin `/og/{id}.png`). */
const DEFAULT_LOCAL_PUBLIC_DIR = 'og'
const DEFAULT_CONTENT_TYPE = 'image/png'
const DEFAULT_SITE_NAME = 'Photo Gallery'
const DEFAULT_ACCENT_COLOR = '#007bff'

type UploadableStorageConfig = Exclude<StorageConfig, { provider: 'eagle' }>

interface OgImagePluginOptions {
  enable?: boolean
  /**
   * Remote storage key prefix for uploaded OG PNGs.
   * Defaults to `.afilmory/og-images`.
   */
  directory?: string
  storageConfig?: UploadableStorageConfig
  contentType?: string
  siteName?: string
  accentColor?: string
  siteConfigPath?: string
  vendor?: OgVendorConfig
  /**
   * Write PNG share cards under `apps/web/public/og/{id}.png` so static hosts
   * (Cloudflare Pages, etc.) can serve them at `/og/{id}.png` without a dynamic
   * `/og/:id` API. Defaults to `true`.
   *
   * This is **not** a second gallery thumbnail — cards are 1200×628 composed PNGs
   * for crawlers; gallery thumbs stay WebP under `/thumbnails/`.
   */
  localPublic?: boolean
  /**
   * Upload OG PNGs to remote storage (S3/GitHub/…). Defaults to `true` when a
   * non-eagle storage provider is available. Set `false` for pure static deploys
   * that only need `localPublic` files.
   */
  uploadRemote?: boolean
}

type OgVendorConfig = CloudflareMiddlewareVendorConfig

interface ResolvedPluginConfig {
  directory: string
  remotePrefix: string
  contentType: string
  useDefaultStorage: boolean
  storageConfig: UploadableStorageConfig | null
  enabled: boolean
  localPublic: boolean
  uploadRemote: boolean
}

interface SiteMeta {
  siteName: string
  accentColor?: string
}

interface PluginRunState {
  uploaded: Set<string>
  urlCache: Map<string, string>
  fonts?: SatoriOptions['fonts'] | null
  siteMeta?: SiteMeta
}

function normalizeDirectory(directory: string | undefined): string {
  const value = directory?.trim() || DEFAULT_DIRECTORY
  const normalized = value.replaceAll('\\', '/').replaceAll(/^\/+|\/+$/g, '')
  return normalized || DEFAULT_DIRECTORY
}

function trimSlashes(value: string | undefined | null): string | null {
  if (!value) {
    return null
  }
  const normalized = value.replaceAll('\\', '/').replaceAll(/^\/+|\/+$/g, '')
  return normalized.length > 0 ? normalized : null
}

function joinSegments(...segments: Array<string | null | undefined>): string {
  const filtered = segments
    .map(segment => (segment ?? '').replaceAll('\\', '/').replaceAll(/^\/+|\/+$/g, ''))
    .filter(segment => segment.length > 0)
  return filtered.join('/')
}

function resolveSiteConfigPath(siteConfigPath: string | undefined): string {
  if (!siteConfigPath) {
    return path.resolve(repoRoot, 'config.json')
  }
  return path.isAbsolute(siteConfigPath) ? siteConfigPath : path.resolve(repoRoot, siteConfigPath)
}

function resolveRemotePrefix(config: UploadableStorageConfig, directory: string): string {
  switch (config.provider) {
    case 's3':
    case 'oss':
    case 'cos': {
      const base = trimSlashes((config as S3CompatibleConfig).prefix)
      return joinSegments(base, directory)
    }
    default: {
      return joinSegments(directory)
    }
  }
}

/**
 * Get or initialize per-run caches to dedupe uploads and URL lookups.
 */
function getOrCreateRunState(container: Map<string, unknown>): PluginRunState {
  let state = container.get(RUN_STATE_KEY) as PluginRunState | undefined
  if (!state) {
    state = {
      uploaded: new Set<string>(),
      urlCache: new Map<string, string>(),
      fonts: null,
    }
    container.set(RUN_STATE_KEY, state)
  }
  return state
}

async function loadFontFile(fileName: string): Promise<Buffer | null> {
  const candidates = [
    path.join(ogAssetsDir, fileName),
    path.join(repoRoot, 'apps/core/src/modules/content/og/assets', fileName),
    path.join(repoRoot, 'core/src/modules/content/og/assets', fileName),
  ]

  for (const candidate of candidates) {
    const stats = await stat(candidate).catch(() => null)
    if (stats?.isFile()) {
      return await readFile(candidate)
    }
  }

  return null
}

/**
 * Load required fonts for Satori/resvg. Missing fonts cause the plugin to skip rendering.
 */
async function loadFonts(logger: Logger): Promise<SatoriOptions['fonts'] | null> {
  const geist = await loadFontFile('Geist-Medium.ttf')
  const harmony = await loadFontFile('HarmonyOS_Sans_SC_Medium.ttf')

  if (!geist || !harmony) {
    logger.main.warn('OG image plugin: fonts not found, skip rendering for this run.')
    return null
  }

  return [
    {
      name: 'Geist',
      data: geist,
      style: 'normal',
      weight: 400,
    },
    {
      name: 'HarmonyOS Sans SC',
      data: harmony,
      style: 'normal',
      weight: 400,
    },
  ]
}

/**
 * Resolve site branding from a JSON config file, with sane fallbacks when the file is absent.
 */
async function loadSiteMeta(options: OgImagePluginOptions, logger: Logger): Promise<SiteMeta> {
  const fallback: SiteMeta = {
    siteName: options.siteName?.trim() || DEFAULT_SITE_NAME,
    accentColor: options.accentColor?.trim() || DEFAULT_ACCENT_COLOR,
  }

  const siteConfigPath = resolveSiteConfigPath(options.siteConfigPath)

  try {
    const raw = await readFile(siteConfigPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<{ name: string, title: string, accentColor: string }>

    return {
      siteName: parsed.name?.trim() || parsed.title?.trim() || fallback.siteName,
      accentColor: parsed.accentColor?.trim() || fallback.accentColor,
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.main.info(`OG image plugin: using fallback site meta (${siteConfigPath} not readable: ${message}).`)
    return fallback
  }
}

async function resolveThumbnailDataUrl(
  item: PhotoManifestItem,
  pluginData: ThumbnailPluginData | undefined,
  logger: Logger,
): Promise<string | null> {
  // Prefer the in-memory thumbnail to avoid extra reads; fall back to URLs when needed.
  // Gallery thumbs may be WebP — convert to a Satori-safe JPEG data URL (not stored).
  const thumbnailUrl = pluginData?.localUrl || item.thumbnailUrl
  if (!thumbnailUrl) {
    return null
  }

  const contentType = guessImageContentType(thumbnailUrl)

  if (pluginData?.buffer) {
    return toSatoriImageDataUrl(pluginData.buffer, contentType)
  }

  if (/^https?:\/\//i.test(thumbnailUrl)) {
    try {
      const response = await fetch(thumbnailUrl)
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer()
        return toSatoriImageDataUrl(Buffer.from(arrayBuffer), response.headers.get('content-type') ?? contentType)
      }
    }
    catch (error) {
      logger.thumbnail?.warn?.(`OG image plugin: failed to fetch remote thumbnail ${thumbnailUrl}`, error)
    }
  }

  const normalized = thumbnailUrl.replace(/^\/+/, '')
  const localPath = path.join(workdir, 'public', normalized)

  try {
    const localBuffer = await readFile(localPath)
    return toSatoriImageDataUrl(localBuffer, contentType)
  }
  catch (error) {
    logger.thumbnail?.debug?.(`OG image plugin: could not read local thumbnail ${localPath}`, error)
    return null
  }
}

function localPublicOgPath(photoId: string): { filePath: string, publicUrl: string } {
  const fileName = `${photoId}.png`
  return {
    filePath: path.join(workdir, 'public', DEFAULT_LOCAL_PUBLIC_DIR, fileName),
    publicUrl: `/${DEFAULT_LOCAL_PUBLIC_DIR}/${fileName}`,
  }
}

async function writeLocalPublicOg(photoId: string, png: Uint8Array, logger: Logger): Promise<string | null> {
  const { filePath, publicUrl } = localPublicOgPath(photoId)
  try {
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, Buffer.from(png))
    return publicUrl
  }
  catch (error) {
    logger.main.error(`OG image plugin: failed to write local public OG for ${photoId}`, error)
    return null
  }
}

function formatDate(input?: string | null): string | undefined {
  if (!input) {
    return undefined
  }

  const timestamp = Date.parse(input)
  if (Number.isNaN(timestamp)) {
    return undefined
  }

  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Build a lightweight EXIF summary for display; returns null when nothing meaningful is present.
 */
function buildExifInfo(photo: PhotoManifestItem): ExifInfo | null {
  const { exif } = photo
  if (!exif) {
    return null
  }

  const focalLength = exif.FocalLengthIn35mmFormat || exif.FocalLength
  const aperture = exif.FNumber ? `f/${exif.FNumber}` : null
  const iso = exif.ISO ?? null
  const shutterSpeed = exif.ExposureTime ? `${exif.ExposureTime}s` : null
  const camera
    = exif.Make && exif.Model ? `${exif.Make.trim()} ${exif.Model.trim()}`.trim() : (exif.Model ?? exif.Make ?? null)

  if (!focalLength && !aperture && !iso && !shutterSpeed && !camera) {
    return null
  }

  return {
    focalLength: focalLength ?? null,
    aperture,
    iso,
    shutterSpeed,
    camera,
  }
}

function getPhotoDimensions(photo: PhotoManifestItem) {
  return {
    width: photo.width || 1,
    height: photo.height || 1,
  }
}

function createVendor(config: OgVendorConfig): OgVendor {
  switch (config.type) {
    case 'cloudflare-middleware': {
      return new CloudflareMiddlewareVendor(config)
    }
    default: {
      throw new Error(`Unknown OG vendor type: ${String((config as { type?: string }).type)}`)
    }
  }
}

/**
 * Render Open Graph PNG share cards for processed photos.
 *
 * Dual pipeline (best practice):
 * - Gallery thumbnails stay WebP under `/thumbnails/` (display only).
 * - Share cards are 1200×628 PNGs (crawler-safe for X/LinkedIn/Slack/Discord/…).
 *
 * Optionally writes cards to `apps/web/public/og/` for static hosts and/or uploads
 * them to remote storage. Reuses the WebP thumbnail as composition source (decoded
 * via sharp → JPEG data URL in memory; not stored as a second thumb).
 */
export default function ogImagePlugin(options: OgImagePluginOptions = {}): BuilderPlugin {
  let resolved: ResolvedPluginConfig | null = null
  let externalStorageManager: StorageManager | null = null
  let vendor: OgVendor | null = null

  return {
    name: PLUGIN_NAME,
    hooks: {
      onInit: ({ builder, config, logger }) => {
        const enable = options.enable ?? true
        const directory = normalizeDirectory(options.directory)
        const contentType = options.contentType ?? DEFAULT_CONTENT_TYPE
        const localPublic = options.localPublic ?? true

        if (options.vendor && !vendor) {
          try {
            vendor = createVendor(options.vendor)
          }
          catch (error) {
            logger.main.error('OG image plugin: failed to initialize vendor config.', error)
            throw error
          }
        }

        if (!enable) {
          resolved = {
            directory,
            remotePrefix: '',
            contentType,
            useDefaultStorage: true,
            storageConfig: null,
            enabled: false,
            localPublic: false,
            uploadRemote: false,
          }
          return
        }

        const fallbackStorage = config.user?.storage ?? builder.getStorageConfig()
        const storageConfig = (options.storageConfig ?? fallbackStorage) as StorageConfig

        if (storageConfig.provider === 'eagle') {
          // Eagle cannot host remote OG objects; local public output still works.
          const uploadRemote = options.uploadRemote ?? false
          if (!localPublic && !uploadRemote) {
            logger.main.warn(
              'OG image plugin: Eagle storage cannot upload remote OG images and localPublic is off; plugin disabled.',
            )
            resolved = {
              directory,
              remotePrefix: '',
              contentType,
              useDefaultStorage: !options.storageConfig,
              storageConfig: null,
              enabled: false,
              localPublic: false,
              uploadRemote: false,
            }
            return
          }

          resolved = {
            directory,
            remotePrefix: '',
            contentType,
            useDefaultStorage: false,
            storageConfig: null,
            enabled: true,
            localPublic,
            uploadRemote: false,
          }
          logger.main.info(`OG image plugin: Eagle provider — remote upload disabled; localPublic=${localPublic}.`)
          return
        }

        const uploadableConfig = storageConfig as UploadableStorageConfig
        const remotePrefix = resolveRemotePrefix(uploadableConfig, directory)
        const uploadRemote = options.uploadRemote ?? true

        if (!localPublic && !uploadRemote) {
          logger.main.warn('OG image plugin: both localPublic and uploadRemote are false; plugin disabled.')
          resolved = {
            directory,
            remotePrefix: '',
            contentType,
            useDefaultStorage: !options.storageConfig,
            storageConfig: null,
            enabled: false,
            localPublic: false,
            uploadRemote: false,
          }
          return
        }

        resolved = {
          directory,
          remotePrefix,
          contentType,
          useDefaultStorage: !options.storageConfig,
          storageConfig: uploadableConfig,
          enabled: true,
          localPublic,
          uploadRemote,
        }

        if (uploadRemote) {
          if (!options.storageConfig) {
            builder.getStorageManager().addExcludePrefix(remotePrefix)
          }
          else {
            externalStorageManager = new StorageManager(uploadableConfig)
          }
        }

        logger.main.info(`OG image plugin enabled (localPublic=${localPublic}, uploadRemote=${uploadRemote}).`)
      },
      afterPhotoProcess: async ({ builder, payload, runShared, logger }) => {
        if (!resolved || !resolved.enabled) {
          return
        }

        const { item, type } = payload.result
        if (!item) {
          return
        }

        const storageManager = resolved.uploadRemote
          ? resolved.useDefaultStorage
            ? builder.getStorageManager()
            : externalStorageManager
          : null

        if (resolved.uploadRemote && !storageManager) {
          logger.main.warn('OG image plugin could not resolve storage manager for remote upload.')
        }

        const state = getOrCreateRunState(runShared)

        if (!state.siteMeta) {
          state.siteMeta = await loadSiteMeta(options, logger)
        }

        if (!state.fonts) {
          state.fonts = await loadFonts(logger)
        }

        const { fonts } = state
        if (!fonts) {
          return
        }

        const shouldRender = type !== 'skipped' || payload.options.isForceMode || payload.options.isForceManifest
        const remoteKey = resolved.uploadRemote ? joinSegments(resolved.remotePrefix, `${item.id}.png`) : ''
        const localUrl = `/${DEFAULT_LOCAL_PUBLIC_DIR}/${item.id}.png`

        if (!shouldRender) {
          // Prefer same-origin static path when available; otherwise resolve remote URL.
          if (resolved.localPublic) {
            item.ogImageUrl = localUrl
            return
          }

          if (storageManager && remoteKey) {
            try {
              const remoteUrl = await storageManager.generatePublicUrl(remoteKey)
              state.urlCache.set(remoteKey, remoteUrl)
              item.ogImageUrl = remoteUrl
            }
            catch (error) {
              logger.main.info(`OG image plugin: skipped rendering and could not resolve URL for ${remoteKey}.`, error)
            }
          }
          return
        }

        const thumbnailData = payload.context.pluginData[THUMBNAIL_PLUGIN_DATA_KEY] as ThumbnailPluginData | undefined
        const thumbnailSrc = await resolveThumbnailDataUrl(item, thumbnailData, logger)
        const exifInfo = buildExifInfo(item)
        const formattedDate = formatDate(item.exif?.DateTimeOriginal ?? item.lastModified)

        try {
          const png = await renderOgImage({
            template: {
              photoTitle: item.title || item.id || 'Untitled Photo',
              siteName: state.siteMeta.siteName || DEFAULT_SITE_NAME,
              tags: (item.tags ?? []).slice(0, 3),
              formattedDate,
              exifInfo,
              thumbnailSrc,
              photoDimensions: getPhotoDimensions(item),
              accentColor: state.siteMeta.accentColor ?? DEFAULT_ACCENT_COLOR,
            },
            fonts,
          })

          let preferredUrl: string | null = null

          if (resolved.localPublic) {
            preferredUrl = await writeLocalPublicOg(item.id, png, logger)
          }

          if (resolved.uploadRemote && storageManager && remoteKey) {
            const stateForUpload = state
            if (
              !stateForUpload.uploaded.has(remoteKey)
              || payload.options.isForceMode
              || payload.options.isForceManifest
            ) {
              try {
                await storageManager.uploadFile(remoteKey, Buffer.from(png), {
                  contentType: resolved.contentType,
                })
                stateForUpload.uploaded.add(remoteKey)
              }
              catch (error) {
                logger.main.error(`OG image plugin: failed to upload ${remoteKey}`, error)
              }
            }

            if (!preferredUrl) {
              let remoteUrl = stateForUpload.urlCache.get(remoteKey)
              if (!remoteUrl) {
                try {
                  remoteUrl = await storageManager.generatePublicUrl(remoteKey)
                  stateForUpload.urlCache.set(remoteKey, remoteUrl)
                }
                catch (error) {
                  logger.main.error(`OG image plugin: failed to generate URL for ${remoteKey}`, error)
                }
              }
              preferredUrl = remoteUrl ?? null
            }
          }

          if (preferredUrl) {
            item.ogImageUrl = preferredUrl
          }
        }
        catch (error) {
          logger.main.error(`OG image plugin: failed to render OG image for ${item.id}`, error)
        }
      },
      afterBuild: async ({ logger }) => {
        if (!vendor) {
          return
        }

        try {
          await vendor.build({
            repoRoot,
            logger,
            localPublic: resolved?.localPublic ?? true,
          })
        }
        catch (error) {
          logger.main.error('OG image plugin: vendor build step failed.', error)
        }
      },
    },
  }
}

export type { OgImagePluginOptions, OgVendorConfig }

export { type CloudflareMiddlewareVendorConfig } from './vendors/cloudflare-moddleware.js'
export { type OgVendorKind } from './vendors/types.js'
