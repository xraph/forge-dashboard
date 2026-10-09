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
// Encode every identity part independently, including percent, slash and Unicode.
export function runPath(key: RunKey) {
  return `/durable/${encodeURIComponent(key.namespace)}/${encodeURIComponent(key.workflow_id)}/${encodeURIComponent(key.run_id)}`
}

export function displayState(value: string) {
  const label = value.replaceAll("_", " ")
  return label.charAt(0).toUpperCase() + label.slice(1)
}
