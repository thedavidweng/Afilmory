import 'dotenv/config'

import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  server: {
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_BUCKET_NAME: z.string().optional(),
    S3_PREFIX: z.string().optional(),
    S3_CUSTOM_DOMAIN: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    GITHUB_TOKEN: z.string().optional(),
    GITHUB_OWNER: z.string().optional(),
    GITHUB_REPO: z.string().optional(),
    GITHUB_BRANCH: z.string().optional(),
    GITHUB_PATH: z.string().optional(),
    GITHUB_USE_RAW_URL: z.string().optional(),
  },
  client: {},
  clientPrefix: 'NEXT_PUBLIC_',
  runtimeEnv: process.env,
  isServer: typeof window === 'undefined',
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
})
