/**
 * The tenant filter as the contract reads it. null is "every tenant" and
 * leaves the field out. "" is "only rows written with no tenant". Anything
 * else is an exact match. Absent and "" are different requests, so this is
 * the only way a page adds the field.
 */
export function withTenant<T extends Record<string, unknown>>(
  params: T,
  tenant: string | null
): T & { tenant?: string } {
  return tenant === null ? params : { ...params, tenant }
}
