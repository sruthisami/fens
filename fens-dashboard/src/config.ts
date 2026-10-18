const raw = import.meta.env.VITE_API_URL || 'http://localhost:4000';
try {
  new URL(raw);
} catch {
  throw new Error(`VITE_API_URL is not a valid URL: ${raw}`);
}
export const API_URL = raw.replace(/\/$/, '');
