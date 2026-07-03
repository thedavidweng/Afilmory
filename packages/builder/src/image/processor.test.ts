/* eslint-disable test/no-import-node-test -- builder tests run via tsx --test, matching viewer-motion */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'

import { isBitmap } from './processor.js'

test('isBitmap detects BMP magic bytes', () => {
  const bmpHeader = Buffer.from([0x42, 0x4D, 0x00, 0x00])
  const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])

  assert.equal(isBitmap(bmpHeader), true)
  assert.equal(isBitmap(jpegHeader), false)
  assert.equal(isBitmap(Buffer.from([0x42])), false)
})
