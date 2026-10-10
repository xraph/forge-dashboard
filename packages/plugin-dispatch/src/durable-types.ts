/** Mirrors operator DTO JSON tags. Decimal counters never enter Number. */
export interface RunKey {
  namespace: string
  workflow_id: string
  run_id: string
}
export interface DurableExecution extends RunKey {
  workflow_type: string
  build_id: string
  state: string
  revision: string
  last_sequence: string
  run_number: string
  retry_attempt: string
  created_at: string
  updated_at: string
  run_deadline_at: string | null
  execution_deadline_at: string | null
  run_available_at: string | null
  payload: "restricted"
  runtime: "available" | "unavailable"
}
export interface DurableDetail extends DurableExecution {
  links: (RunKey & { kind: string })[]
  links_restricted: boolean
  as_of: string
}
export interface DurablePage<T> {
  items: T[]
  cursor?: string
  complete: boolean
  as_of: string
  observation: string
  total: null
  restricted?: boolean
  revision?: string
  high_water?: string
}
export interface DurableNamespace {
  namespace: string
  app_id: string
  tenant_id: string
}
export interface DurableEvent {
  type: string
  sequence: string
  time: string
}
export interface DurableTask {
  id: string
  kind: string
  state: string
  attempt: string
  version: string
  available_at: string | null
  lease_until: string | null
  deadline_at: string | null
  heartbeat_at: string | null
}
export interface DurableDelivery {
  id: string
  state: string
  attempts: string
  accepted_at: string | null
  sink_accepted_at: string | null
  next_attempt_at: string | null
}
export interface DurableDeliveries extends DurablePage<DurableDelivery> {
  pending: string
  blocked: string
  remote_delivery: "unavailable"
  external_anchoring: "unavailable"
}
export interface DurablePayload {
  state: "revealed"
  encoding: "base64"
  input: string | null
  output: string | null
  revision: string
}
// Router-safe v1 UTF-8 base64url segments, decoded once by the page.
export function encodeRunPart(value: string) {
  const bytes = new TextEncoder().encode(value)
  if (
    !value ||
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) !==
      value
  )
    throw new Error("Invalid execution identity")
  return (
    "v1." +
    btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "")
  )
}
export function decodeRunPart(segment: string | undefined): string {
  if (!segment || !/^v1\.[A-Za-z0-9_-]+$/.test(segment))
    throw new Error("Invalid execution identity")
  const value = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(
    Uint8Array.from(
      atob(segment.slice(3).replaceAll("-", "+").replaceAll("_", "/")),
      (char) => char.charCodeAt(0)
    )
  )
  if (encodeRunPart(value) !== segment)
    throw new Error("Noncanonical execution identity")
  return value
}
export function runPath(key: RunKey) {
  return `/durable/${encodeRunPart(key.namespace)}/${encodeRunPart(key.workflow_id)}/${encodeRunPart(key.run_id)}`
}

export function displayState(value: string) {
  const label = value.replaceAll("_", " ")
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export interface DurableCapabilities {
  runtime: "available" | "unavailable"
  actions: Record<string, boolean>
}
export interface DurableStart extends RunKey {
  request_id: string
  workflow_type: string
  build_id: string
  queue: string
  input: string
}
export interface DurableSignal extends RunKey {
  request_id: string
  build_id: string
  name: string
  input: string
}
export interface DurableSignalStart {
  start: DurableStart
  name: string
  input: string
}
export interface DurableCancel extends RunKey {
  request_id: string
  build_id: string
  reason: string
}
export interface DurableAcceptance extends RunKey {
  request_id: string
  revision: string
  first_sequence: string
  last_sequence: string
  status: string
  started?: boolean
}
export interface DurableQueryResult extends RunKey {
  state: string
  revision: string
  last_sequence: string
  encoding: "base64"
  output: string | null
}
