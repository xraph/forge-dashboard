/**
 * The wire shapes of Tether's dashboard contract, mirrored from
 * `extension/contract/types.go` in the tether repo (and its llm.txt). Field
 * names are the Go JSON tags, camelCase. Times are RFC 3339 strings.
 *
 * Intents this package reads or sends today are typed in full. The rest of the
 * contract's shapes (devices, roles, clients, retained) are here too, because
 * the tenant tabs that arrive next read them and the shapes belong in one file.
 */

/** A tenant's limits. Every number is 0 for "default or unlimited". */
export interface Limits {
  maxConnections: number
  messagesPerSecond: number
  burst: number
  maxSessionExpirySeconds: number
}

export interface Tenant {
  /** `ttnt_...` */
  id: string
  appId: string
  externalId: string
  name: string
  enabled: boolean
  limits: Limits
  createdAt: string
  updatedAt: string
}

export interface Device {
  /** `tdev_...` */
  id: string
  tenantId: string
  name: string
  /** The keysmith key ID, `akey_...`, which is also the MQTT username. */
  keyId: string
  clientId?: string
  roles: string[]
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** What `devices.provision` and `devices.rotate` answer, once. */
export interface Credentials {
  device: Device
  username: string
  password: string
}

export interface Client {
  clientId: string
  username?: string
  deviceId?: string
  remote?: string
  connected: boolean
  protocolVersion: 4 | 5
  subscriptions: string[]
  connectedAt?: string
  sessionExpirySeconds: number
}

export interface Retained {
  topic: string
  size: number
  qos: number
}

/**
 * `overview.stats`. Without a `tenantId` it is the node total
 * (`scope: "node"`, `tenants` is the tenant count, every other count a sum).
 * With one it is that tenant's counters on this node, with no `tenants`.
 */
export interface Stats {
  scope: "node" | "tenant"
  tenantId?: string
  tenants?: number
  connected: number
  sessions: number
  subscriptions: number
  retained: number
  messagesIn: number
  messagesOut: number
}

export interface TopicRules {
  roleSlug: string
  publish: string[]
  subscribe: string[]
}

export interface Role {
  slug: string
  name: string
  parentSlug?: string
  publish: string[]
  subscribe: string[]
}

/** `tenants.list`. A full page (`items.length === limit`) may have a next one. */
export interface TenantsList {
  items: Tenant[]
  limit: number
  offset: number
}

export interface DevicesList {
  items: Device[]
  limit: number
  offset: number
}

export interface RolesList {
  items: Role[]
}

export interface ClientsList {
  items: Client[]
}

export interface RetainedList {
  items: Retained[]
}

/** The answer of a command that returns nothing. */
export interface Ack {
  ok: boolean
}

/** `tenants.create` input. `limits` is left off when the operator set none. */
export interface CreateTenantInput {
  appId: string
  externalId: string
  name: string
  limits?: Limits
}

/**
 * `tenants.update` input. The Go side takes pointers: a field that is absent
 * is left alone, so the toggle sends `enabled` and nothing else.
 */
export interface UpdateTenantInput {
  tenantId: string
  name?: string
  enabled?: boolean
  limits?: Limits
}
