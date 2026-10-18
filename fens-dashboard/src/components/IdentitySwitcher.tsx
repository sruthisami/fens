import { identity, setIdentity, TENANTS, tenantOf } from '../identity';
interface Props {
  onChange: () => void;
}
export function IdentitySwitcher({ onChange }: Props) {
  const cur = identity();
  const tenant = tenantOf(cur);
  return (
    <div className="identity" role="group" aria-label="Tenant and user">
      <label className="field" htmlFor="identity-tenant">
        Tenant
      </label>
      <select
        id="identity-tenant"
        value={cur.tenant}
        onChange={(e) => {
          const t = TENANTS.find((x) => x.id === e.target.value);
          if (!t) return;
          setIdentity({ tenant: t.id, user: t.users[0]?.id ?? '' });
          onChange();
        }}
      >
        {TENANTS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <label className="field" htmlFor="identity-user">
        User
      </label>
      <select
        id="identity-user"
        value={cur.user}
        onChange={(e) => {
          setIdentity({ tenant: cur.tenant, user: e.target.value });
          onChange();
        }}
      >
        {tenant.users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </div>
  );
}
