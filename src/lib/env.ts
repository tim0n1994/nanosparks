import { z } from 'zod';

import { configuredYouTubeApiKey } from '@/lib/youtube/api-key';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  YOUTUBE_API_KEY: z.string().optional().transform(configuredYouTubeApiKey),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  WHISPER_API_KEY: z.string().optional(),
  WHISPER_MODEL_PATH: z.string().optional().default('/tmp/whisper'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.'));
    throw new Error(`Missing or invalid environment variables: ${missing.join(', ')}`);
  }
  return parsed.data;
}

export const env = validateEnv();
