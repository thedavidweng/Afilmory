/* eslint-disable test/no-import-node-test -- builder tests run via tsx --test, matching viewer-motion */
import assert from 'node:assert/strict'
import test from 'node:test'

import { RASTER_FORMATS, RAW_FORMATS, SUPPORTED_FORMATS, usesOriginalBufferForExif } from './index.js'

test('SUPPORTED_FORMATS unions raster and RAW extensions', () => {
  for (const ext of RASTER_FORMATS) {
    assert.ok(SUPPORTED_FORMATS.has(ext), `missing raster extension ${ext}`)
  }

  for (const ext of RAW_FORMATS) {
    assert.ok(SUPPORTED_FORMATS.has(ext), `missing RAW extension ${ext}`)
  }
})

test('SUPPORTED_FORMATS includes AVIF and common camera RAW extensions', () => {
  assert.ok(SUPPORTED_FORMATS.has('.avif'))
  assert.ok(SUPPORTED_FORMATS.has('.cr2'))
  assert.ok(SUPPORTED_FORMATS.has('.cr3'))
  assert.ok(SUPPORTED_FORMATS.has('.nef'))
  assert.ok(SUPPORTED_FORMATS.has('.arw'))
  assert.ok(SUPPORTED_FORMATS.has('.dng'))
  assert.ok(SUPPORTED_FORMATS.has('.raf'))
})

test('SUPPORTED_FORMATS excludes formats that are unsupported or too ambiguous', () => {
  assert.ok(!SUPPORTED_FORMATS.has('.jxl'))
  assert.ok(!SUPPORTED_FORMATS.has('.data'))
  assert.ok(!SUPPORTED_FORMATS.has('.svg'))
  assert.ok(!SUPPORTED_FORMATS.has('.gif'))
  assert.ok(!SUPPORTED_FORMATS.has('.ico'))
})

test('usesOriginalBufferForExif returns true for HEIC and RAW extensions', () => {
  assert.equal(usesOriginalBufferForExif('.heic'), true)
  assert.equal(usesOriginalBufferForExif('heif'), true)
  assert.equal(usesOriginalBufferForExif('.CR3'), true)
  assert.equal(usesOriginalBufferForExif('dng'), true)
})

test('usesOriginalBufferForExif returns false for standard raster extensions', () => {
  assert.equal(usesOriginalBufferForExif('.jpg'), false)
  assert.equal(usesOriginalBufferForExif('.jpeg'), false)
  assert.equal(usesOriginalBufferForExif('.png'), false)
  assert.equal(usesOriginalBufferForExif('.avif'), false)
  assert.equal(usesOriginalBufferForExif('.webp'), false)
})
