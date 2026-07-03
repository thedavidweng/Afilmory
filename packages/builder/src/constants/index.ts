export const RASTER_FORMATS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.bmp',
  '.tiff',
  '.tif',
  '.avif',
  '.heic',
  '.heif',
  '.hif',
])

export const HEIC_FORMATS = new Set(['.heic', '.heif', '.hif'])

export const RAW_FORMATS = new Set([
  '.3fr',
  '.ari',
  '.arw',
  '.bay',
  '.cap',
  '.cr2',
  '.cr3',
  '.crw',
  '.dcr',
  '.dcs',
  '.dng',
  '.drf',
  '.eip',
  '.erf',
  '.fff',
  '.gpr',
  '.iiq',
  '.k25',
  '.kdc',
  '.mdc',
  '.mef',
  '.mos',
  '.mrw',
  '.nef',
  '.nrw',
  '.obm',
  '.orf',
  '.ori',
  '.pef',
  '.ptx',
  '.pxn',
  '.r3d',
  '.raf',
  '.raw',
  '.rw2',
  '.rwl',
  '.rwz',
  '.sr2',
  '.srf',
  '.srw',
  '.x3f',
])

export const SUPPORTED_FORMATS = new Set([...RASTER_FORMATS, ...RAW_FORMATS])

const normalizeExtension = (ext: string) => (ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`)

/** HEIC/HEIF and RAW files must be read from the original buffer for complete EXIF. */
export function usesOriginalBufferForExif(ext: string): boolean {
  const normalized = normalizeExtension(ext)
  return HEIC_FORMATS.has(normalized) || RAW_FORMATS.has(normalized)
}
