import { resolve } from 'node:path';
import { z } from 'zod';
try {
  process.loadEnvFile('.env');
} catch {}
const raw = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [key, value === '' ? undefined : value]),
);
const envSchema = z.object({
  FALKORDB_URL: z.url().default('redis://localhost:6379'),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GITHUB_TOKEN: z.string().min(1).optional(),
  FIGMA_TOKEN: z.string().min(1).optional(),
  LINEAR_API_KEY: z.string().min(1).optional(),
  LINEAR_TEAM_ID: z.string().min(1).max(100).optional(),
  FIGMA_FILE_KEY: z
    .string()
    .regex(/^[A-Za-z0-9]+$/, 'FIGMA_FILE_KEY is the key from the file URL')
    .optional(),
  GEMINI_EMBEDDING_MODEL: z.string().min(1).max(100).default('gemini-embedding-001'),
  GEMINI_MODEL: z.string().min(1).max(100).optional(),
  GEMINI_FALLBACK_MODEL: z.string().min(1).max(100).optional(),
  GITHUB_REPO: z
    .string()
    .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, 'GITHUB_REPO must look like owner/name')
    .optional(),
  ALLOWED_ORIGIN: z.url().default('http://localhost:5173'),
  ARTIFACTS_DIR: z
    .string()
    .min(1)
    .default('../fens-explorer/artifacts')
    .transform((dir) => resolve(dir)),
});
const parsed = envSchema.safeParse(raw);
if (!parsed.success) {
  console.error('Invalid environment variables:\n' + z.prettifyError(parsed.error));
  process.exit(1);
}
export const env = parsed.data;
