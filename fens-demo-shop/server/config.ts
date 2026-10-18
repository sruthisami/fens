import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export type ShopVersion = 'v1' | 'v2';
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const VERSION: ShopVersion = process.env.SHOP_VERSION === 'v2' ? 'v2' : 'v1';
export const DEV = process.env.SHOP_DEV === '1';
const port = Number(process.env.PORT ?? (VERSION === 'v2' ? 5175 : 5174));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`PORT must be an integer between 1 and 65535, got ${process.env.PORT}`);
}
export const PORT = port;
export const CLIENT_DIR = join(ROOT, 'dist', VERSION);
export const SSR_ENTRY = join(ROOT, 'dist', `ssr-${VERSION}`, 'entry-server.js');
