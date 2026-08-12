import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import nunjucks from 'nunjucks'

import type { Logger } from '../../../logger/index.js'
import type { OgVendorBuildContext } from './types.js'
import { OgVendor } from './types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const templatesDir = path.join(__dirname, 'templates')
const nunjucksEnv = nunjucks.configure(templatesDir, { autoescape: false })

const DEFAULT_SITE_ORIGIN = 'https://example.com'

export interface CloudflareMiddlewareVendorConfig {
  type: 'cloudflare-middleware'
  /**
   * CDN/origin that serves remote OG PNGs (used when `mode` is `remote`).
   * Example: `https://cdn.example.com` → `{storageURL}/.afilmory/og-images/{id}.png`
   *
   * Optional when `mode: 'local'` (same-origin `/og/{id}.png` from `localPublic` output).
   */
  storageURL?: string
  siteConfigPath?: string
  /**
   * `local` — rewrite meta to `{siteOrigin}/og/{id}.png` (static public files).
   * `remote` — rewrite meta to `{storageURL}/.afilmory/og-images/{id}.png`.
   * Defaults to `local` when `storageURL` is omitted, otherwise `remote`.
   */
  mode?: 'local' | 'remote'
}

function escapeRegexLiteral(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeUrlToOrigin(value: string | undefined | null): string | null {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const parsed = new URL(withProtocol)
    return parsed.origin
  }
  catch {
    return null
  }
}

function normalizeUrlToBase(value: string | undefined | null): string | null {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const parsed = new URL(withProtocol)
    const pathname = parsed.pathname.replace(/\/+$|^\/+/, '')
    const suffix = pathname ? `/${pathname}` : ''
    return `${parsed.origin}${suffix}`
  }
  catch {
    return null
  }
}

function resolveSiteConfigPath(siteConfigPath: string | undefined, repoRoot: string): string {
  if (!siteConfigPath) {
    return path.resolve(repoRoot, 'config.json')
  }
  return path.isAbsolute(siteConfigPath) ? siteConfigPath : path.resolve(repoRoot, siteConfigPath)
}

async function loadSiteUrl(
  siteConfigPath: string | undefined,
  repoRoot: string,
  logger: Logger,
): Promise<string | null> {
  const target = resolveSiteConfigPath(siteConfigPath, repoRoot)

  try {
    const raw = await readFile(target, 'utf8')
    const parsed = JSON.parse(raw) as Partial<{ url?: string }>
    const normalized = normalizeUrlToOrigin(parsed.url)

    if (!normalized) {
      logger.main.info(`OG image plugin: missing or invalid site.url in ${target}, using fallback origin.`)
      return null
    }

    return normalized
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.main.info(`OG image plugin: using fallback origin (cannot read ${target}: ${message}).`)
    return null
  }
}

function renderCloudflareMiddlewareTemplate(patternHost: string, ogBase: string): string {
  return nunjucksEnv.render('cloudflare-middleware.njk', {
    patternHost,
    ogBase,
  })
}

export class CloudflareMiddlewareVendor extends OgVendor {
  readonly type = 'cloudflare-middleware' as const

  constructor(private readonly options: CloudflareMiddlewareVendorConfig) {
    super()
  }

  private resolveMode(contextLocalPublic?: boolean): 'local' | 'remote' {
    if (this.options.mode) {
      return this.options.mode
    }
    if (!this.options.storageURL) {
      return 'local'
    }
    // Prefer local when the OG plugin is writing public/og cards.
    if (contextLocalPublic) {
      return 'local'
    }
    return 'remote'
  }

  private normalizeStorageOrigin(): string {
    const normalized = normalizeUrlToBase(this.options.storageURL)
    if (!normalized) {
      throw new Error(
        'CloudflareMiddleware vendor (remote mode) requires a valid storageURL (e.g., https://cdn.example.com)',
      )
    }
    return normalized
  }

  private async resolveSiteOrigin(logger: Logger, repoRoot: string): Promise<string> {
    const loaded = await loadSiteUrl(this.options.siteConfigPath, repoRoot, logger)
    return loaded ?? DEFAULT_SITE_ORIGIN
  }

  private renderTemplate(siteOrigin: string, ogBase: string): string {
    const siteHost = normalizeUrlToOrigin(siteOrigin) ?? DEFAULT_SITE_ORIGIN

    const patternHost = (() => {
      try {
        return escapeRegexLiteral(new URL(siteHost).host)
      }
      catch {
        return escapeRegexLiteral(new URL(DEFAULT_SITE_ORIGIN).host)
      }
    })()

    return renderCloudflareMiddlewareTemplate(patternHost, ogBase)
  }

  async build(context: OgVendorBuildContext): Promise<void> {
    const siteOrigin = await this.resolveSiteOrigin(context.logger, context.repoRoot)
    const mode = this.resolveMode(context.localPublic)

    const ogBase
      = mode === 'local'
        ? `${normalizeUrlToOrigin(siteOrigin) ?? DEFAULT_SITE_ORIGIN}/og`
        : `${this.normalizeStorageOrigin()}/.afilmory/og-images`

    const content = this.renderTemplate(siteOrigin, ogBase)

    // Cloudflare Pages resolves `functions/` next to the Pages project
    // (`apps/web` when using apps/web/wrangler.jsonc). Also write repo-root
    // `functions/` for docs/examples that deploy from the monorepo root.
    const targets = [
      path.join(context.repoRoot, 'apps/web/functions', '_middleware.ts'),
      path.join(context.repoRoot, 'functions', '_middleware.ts'),
    ]

    for (const target of targets) {
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, content, 'utf8')
      context.logger.main.info(
        `OG image vendor (CloudflareMiddleware): wrote ${target} (mode=${mode}, ogBase=${ogBase})`,
      )
    }
  }
}
