import { z } from 'zod';
try {
  process.loadEnvFile('.env');
} catch {}
const raw = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [key, value === '' ? undefined : value]),
);
const envSchema = z.object({
  FALKORDB_URL: z.url().default('redis://localhost:6379'),
  TARGET_URL: z.url().default('http://localhost:5174'),
});
const parsed = envSchema.safeParse(raw);
if (!parsed.success) {
  console.error('Invalid environment variables:\n' + z.prettifyError(parsed.error));
  process.exit(1);
}
export const env = parsed.data;
