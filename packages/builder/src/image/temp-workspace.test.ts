/* eslint-disable test/no-import-node-test -- builder tests run via tsx --test, matching viewer-motion */
import assert from 'node:assert/strict'
import test from 'node:test'

import { IMAGE_PROCESS_TEMP_DIR } from './temp-workspace.js'

test('IMAGE_PROCESS_TEMP_DIR lives under the OS temp directory', () => {
  assert.match(IMAGE_PROCESS_TEMP_DIR, /afilmory_image_process$/)
})
