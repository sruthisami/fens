export function normalizePath(input: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(input, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const path = url.pathname
    .toLowerCase()
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '');
  return path === '' ? '/' : path;
}
export function isSameOrigin(input: string, origin: string): boolean {
  try {
    return new URL(input, origin).origin === origin;
  } catch {
    return false;
  }
}
export function screenFileName(id: string): string {
  if (id === '/') return 'root';
  return id
    .slice(1)
    .replace(/\*/g, 'all')
    .replace(/[^a-z0-9._-]+/gi, '__');
}
export function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
