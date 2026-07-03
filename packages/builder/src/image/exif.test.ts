/* eslint-disable test/no-import-node-test -- builder tests run via tsx --test, matching viewer-motion */
import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveExifTempExtension } from './exif.js'

test('resolveExifTempExtension defaults to .jpg for processed buffers', () => {
  assert.equal(resolveExifTempExtension(), '.jpg')
  assert.equal(resolveExifTempExtension('photos/sample.cr2'), '.jpg')
  assert.equal(resolveExifTempExtension('photos/sample.cr2', false), '.jpg')
})

test('resolveExifTempExtension preserves the source extension for original buffers', () => {
  assert.equal(resolveExifTempExtension('photos/sample.cr2', true), '.cr2')
  assert.equal(resolveExifTempExtension('photos/sample.HEIC', true), '.heic')
  assert.equal(resolveExifTempExtension('photos/sample.dng', true), '.dng')
})

test('resolveExifTempExtension falls back to .bin when the source key has no extension', () => {
  assert.equal(resolveExifTempExtension('photos/no-extension', true), '.bin')
})
