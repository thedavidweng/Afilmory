import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const IMAGE_PROCESS_TEMP_DIR = path.join(os.tmpdir(), 'afilmory_image_process')

export async function ensureImageProcessTempDir(): Promise<void> {
  await mkdir(IMAGE_PROCESS_TEMP_DIR, { recursive: true })
}
