import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { ImageMetadata } from '@afilmory/typing'
import * as bmp from '@vingle/bmp-js'
import heicConvert from 'heic-convert'
import sharp from 'sharp'

import { HEIC_FORMATS, RAW_FORMATS } from '../constants/index.js'
import { getGlobalLoggers } from '../photo/logger-adapter.js'
import { exiftool } from './exif.js'
import { ensureImageProcessTempDir, IMAGE_PROCESS_TEMP_DIR } from './temp-workspace.js'

export async function getImageMetadataWithSharp(sharpInstance: sharp.Sharp): Promise<ImageMetadata | null> {
  const log = getGlobalLoggers().image

  try {
    const metadata = await sharpInstance.metadata()

    if (!metadata.width || !metadata.height || !metadata.format) {
      log.error('图片元数据不完整')
      return null
    }

    let { width } = metadata
    let { height } = metadata

    const { orientation } = metadata
    if (orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8) {
      ;[width, height] = [height, width]
      log.info(`检测到需要旋转 90°的图片 (orientation: ${orientation})，交换宽高：${width}x${height}`)
    }

    return {
      width,
      height,
      format: metadata.format,
    }
  }
  catch (error) {
    log.error('获取图片元数据失败：', error)
    return null
  }
}

export async function convertHeicToJpeg(heicBuffer: Buffer): Promise<Buffer> {
  const log = getGlobalLoggers().image

  try {
    log.info(`开始 HEIC/HEIF → JPEG 转换 (${Math.round(heicBuffer.length / 1024)}KB)`)
    const startTime = Date.now()

    const jpegBuffer = await heicConvert({
      buffer: heicBuffer,
      format: 'JPEG',
      quality: 0.95,
    })

    const duration = Date.now() - startTime
    const outputSizeKB = Math.round(jpegBuffer.byteLength / 1024)
    log.success(`HEIC/HEIF 转换完成 (${outputSizeKB}KB, ${duration}ms)`)

    return Buffer.from(jpegBuffer)
  }
  catch (error) {
    log.error('HEIC/HEIF 转换失败：', error)
    throw error
  }
}

export const RAW_PREVIEW_TAGS = ['JpgFromRaw', 'PreviewImage', 'OtherImage', 'ThumbnailImage'] as const

export const RAW_LOW_QUALITY_PREVIEW_TAG = 'ThumbnailImage' as const

export function isLowQualityRawPreviewTag(tag: string): boolean {
  return tag === RAW_LOW_QUALITY_PREVIEW_TAG
}

export async function extractRawPreviewToBuffer(rawBuffer: Buffer, key: string): Promise<Buffer> {
  const log = getGlobalLoggers().image
  const safeExt = path.extname(key).toLowerCase() || '.raw'
  const tempRawPath = path.join(IMAGE_PROCESS_TEMP_DIR, `${crypto.randomUUID()}${safeExt}`)

  try {
    await ensureImageProcessTempDir()
    await writeFile(tempRawPath, rawBuffer)

    for (const tag of RAW_PREVIEW_TAGS) {
      try {
        const previewBuffer = await exiftool.extractBinaryTagToBuffer(tag, tempRawPath)
        if (previewBuffer.length > 0) {
          if (isLowQualityRawPreviewTag(tag)) {
            log.warn(`RAW 仅找到 ThumbnailImage 嵌入预览（通常约 160×120），缩略图与影调分析质量可能下降：${key}`)
          }
          log.success(`RAW 预览图提取完成 (${tag}, ${Math.round(previewBuffer.length / 1024)}KB)`)
          return previewBuffer
        }
      }
      catch (error) {
        log.originalLogger.debug(`RAW 预览标签 ${tag} 不可用：${key}`, error)
      }
    }

    throw new Error(`未能从 RAW 文件中提取可用预览图：${key}`)
  }
  finally {
    await unlink(tempRawPath).catch(() => undefined)
  }
}

export async function preprocessImageBuffer(buffer: Buffer, key: string): Promise<Buffer> {
  const log = getGlobalLoggers().image
  const ext = path.extname(key).toLowerCase()

  if (HEIC_FORMATS.has(ext)) {
    log.info(`检测到 HEIC/HEIF 格式：${key}`)
    return await convertHeicToJpeg(buffer)
  }

  if (RAW_FORMATS.has(ext)) {
    log.info(`检测到 RAW 格式：${key}`)
    return await extractRawPreviewToBuffer(buffer, key)
  }

  return buffer
}

const BUF_BMP = Buffer.from([0x42, 0x4D])

export function isBitmap(buf: Buffer): boolean {
  if (buf.length < 2) {
    return false
  }
  return Buffer.compare(BUF_BMP, buf.slice(0, 2)) === 0
}

export async function convertBmpToJpegSharpInstance(bmpBuffer: Buffer): Promise<sharp.Sharp> {
  const log = getGlobalLoggers().image

  try {
    log.info(`开始 BMP → JPEG 转换 (${Math.round(bmpBuffer.length / 1024)}KB)`)
    const startTime = Date.now()

    const bmpImage = bmp.decode(bmpBuffer, true)
    if (!bmpImage) {
      throw new Error('BMP 解码失败')
    }

    const channels = bmpImage.data.length / (bmpImage.width * bmpImage.height)
    if (channels !== 3 && channels !== 4) {
      throw new Error(`Unsupported BMP channel count: ${channels}`)
    }

    const sharpInstance = sharp(bmpImage.data, {
      raw: { width: bmpImage.width, height: bmpImage.height, channels },
    }).jpeg()

    const duration = Date.now() - startTime
    log.success(`BMP 转换完成 (${duration}ms)`)

    return sharpInstance
  }
  catch (error) {
    log.error('BMP 转换失败：', error)
    throw error
  }
}
