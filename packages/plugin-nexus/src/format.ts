export const validID = (value: string | undefined, kind: "tenant" | "key") =>
  typeof value === "string" &&
  new RegExp(`^${kind}_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$`).test(value)
export const tenantPath = (id: string) => `/tenants/${encodeURIComponent(id)}`
export const keyPath = (id: string) => `/keys/${encodeURIComponent(id)}`
