export interface DevTenant {
  id: string;
  name: string;
  token: string;
  users: {
    id: string;
    name: string;
  }[];
}
const DEFAULT_TENANTS: DevTenant[] = [
  {
    id: 'fence-team',
    name: 'Fence team',
    token: 'dev-fence-team',
    users: [
      { id: 'ana', name: 'Ana' },
      { id: 'ben', name: 'Ben' },
    ],
  },
  {
    id: 'acme-demo',
    name: 'Acme demo',
    token: 'dev-acme-demo',
    users: [{ id: 'chris', name: 'Chris' }],
  },
];
function parseTenants(): DevTenant[] {
  const raw = import.meta.env.VITE_TENANTS;
  if (!raw) return DEFAULT_TENANTS;
  try {
    const list = JSON.parse(raw) as DevTenant[];
    return Array.isArray(list) && list.length ? list : DEFAULT_TENANTS;
  } catch {
    return DEFAULT_TENANTS;
  }
}
export const TENANTS = parseTenants();
export interface Identity {
  tenant: string;
  user: string;
}
const KEY = 'flowlens.identity';
function load(): Identity {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Identity | null;
    const t = TENANTS.find((x) => x.id === saved?.tenant);
    if (t && t.users.some((u) => u.id === saved?.user)) return saved as Identity;
  } catch {}
  const first = TENANTS[0] as DevTenant;
  return { tenant: first.id, user: first.users[0]?.id ?? '' };
}
let current = load();
export const identity = () => current;
export const tenantOf = (id: Identity = current) =>
  TENANTS.find((t) => t.id === id.tenant) ?? (TENANTS[0] as DevTenant);
export function setIdentity(next: Identity): void {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
}
export function authHeaders(): Record<string, string> {
  return { 'X-Tenant-Token': tenantOf().token, 'X-User': current.user };
}
export function authQuery(): string {
  return `tenant_token=${encodeURIComponent(tenantOf().token)}&user=${encodeURIComponent(current.user)}`;
}
