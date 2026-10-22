import type { Limits, Tenant } from "./types"

const COUNT = new Intl.NumberFormat("en-US")

/** 1234567 as "1,234,567". */
export function formatCount(n: number): string {
  return COUNT.format(n)
}

const UNITS: [string, number][] = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
]

/**
 * A span of seconds in the largest unit that divides it evenly: 86400 is "1
 * day", 5400 is "90 minutes", 45 is "45 seconds". Never a fraction, so what is
 * shown is exactly what is stored.
 */
export function formatSeconds(seconds: number): string {
  for (const [unit, size] of UNITS) {
    if (seconds >= size && seconds % size === 0) {
      const n = seconds / size
      return `${formatCount(n)} ${unit}${n === 1 ? "" : "s"}`
    }
  }
  return `${formatCount(seconds)} second${seconds === 1 ? "" : "s"}`
}

/** The scope-relative path of a tenant's page. */
export function tenantPath(id: string): string {
  return `/tenants/${encodeURIComponent(id)}`
}

/** What names a tenant to an operator: its name, else its external ID. */
export function tenantLabel(tenant: Pick<Tenant, "name" | "externalId">) {
  return tenant.name.trim() === "" ? tenant.externalId : tenant.name
}

/**
 * The limits a tenant has set, as one line. Null when every limit is 0, which
 * the broker reads as its default (or unlimited), so the caller can say that
 * instead of printing four zeros.
 */
export function limitsSummary(limits: Limits): string | null {
  const parts: string[] = []
  if (limits.maxConnections > 0) {
    parts.push(`${formatCount(limits.maxConnections)} connections`)
  }
  if (limits.messagesPerSecond > 0) {
    parts.push(`${formatCount(limits.messagesPerSecond)} msg/s`)
  }
  if (limits.burst > 0) parts.push(`burst ${formatCount(limits.burst)}`)
  if (limits.maxSessionExpirySeconds > 0) {
    parts.push(
      `${formatSeconds(limits.maxSessionExpirySeconds)} session expiry`
    )
  }
  return parts.length === 0 ? null : parts.join(", ")
}

/** The scope-relative path of a device's page. */
export function devicePath(tenantId: string, deviceId: string): string {
  return `${tenantPath(tenantId)}/devices/${encodeURIComponent(deviceId)}`
}

/**
 * Where this device's keysmith key is. Absolute on purpose: a path starting
 * with the scope sigil is passed through by `PluginLink`, which is how a page
 * links into another plugin. Keysmith mounts at "/@keysmith" and routes its key
 * page at "/keys/:id".
 */
export function keysmithKeyPath(keyId: string): string {
  return `/@keysmith/keys/${encodeURIComponent(keyId)}`
}

/**
 * The warden subject a device's key is granted its roles as: warden's
 * `api_key` subject kind and the key ID. Warden mounts at "/@warden" and routes
 * "/subjects/:kind/:id".
 */
export function wardenSubjectPath(keyId: string): string {
  return `/@warden/subjects/api_key/${encodeURIComponent(keyId)}`
}
