import type { Client, Device, Role } from "../src/types"

export const TENANT_ID = "ttnt_01acme"

export function device(over: Partial<Device> = {}): Device {
  return {
    id: "tdev_01thermo",
    tenantId: TENANT_ID,
    name: "Thermostat",
    keyId: "akey_01thermo",
    roles: ["sensor"],
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
    ...over,
  }
}

export const THERMO = device()
export const GATE = device({
  id: "tdev_02gate",
  name: "Gate controller",
  keyId: "akey_02gate",
  clientId: "gate-1",
  roles: [],
})

export function devices(...items: Device[]) {
  return { items, limit: 100, offset: 0 }
}

export function role(over: Partial<Role> = {}): Role {
  return {
    slug: "reader",
    name: "Reader",
    publish: [],
    subscribe: ["broadcast/#"],
    ...over,
  }
}

export const READER = role()
export const SENSOR = role({
  slug: "sensor",
  name: "Sensor",
  parentSlug: "reader",
  publish: ["devices/%c/up"],
  subscribe: ["devices/%c/down"],
})

export function roles(...items: Role[]) {
  return { items }
}

export function client(over: Partial<Client> = {}): Client {
  return {
    clientId: "thermo-1",
    username: "akey_01thermo",
    deviceId: "tdev_01thermo",
    remote: "10.0.0.7:51234",
    connected: true,
    protocolVersion: 5,
    subscriptions: ["devices/thermo-1/down"],
    connectedAt: "2026-10-22T08:00:00Z",
    sessionExpirySeconds: 3600,
    ...over,
  }
}

export const ONLINE = client()
export const OFFLINE = client({
  clientId: "gate-1",
  username: "akey_02gate",
  deviceId: "tdev_02gate",
  remote: undefined,
  connected: false,
  protocolVersion: 4,
  subscriptions: [],
  connectedAt: undefined,
  sessionExpirySeconds: 0,
})

export function clients(...items: Client[]) {
  return { items }
}

export const ACK = { ok: true }

export const PASSWORD = "tdk_live_s3cr3t-value-0123456789"

export function credentials(d: Device = THERMO) {
  return { device: d, username: d.keyId, password: PASSWORD }
}
