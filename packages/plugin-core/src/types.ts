export interface Overview {
  overallHealth: string
  totalServices: number
  healthyServices: number
  totalMetrics: number
  uptimeSeconds: number
  version: string
  environment: string
}
export interface Service {
  name: string
  type: string
  status: string
  registered_at?: string
}
export interface ServiceDetail extends Service {
  health?: {
    status: string
    message: string
    duration: number
    critical: boolean
  }
  metrics: Record<string, unknown> | null
  dependencies: string[] | null
  last_health_check: string
  uptime?: number
}
export interface Health {
  overallStatus: string
  healthySummary: number
  total: number
  services:
    | {
        name: string
        status: string
        message?: string
        durationMs: number
        critical: boolean
      }[]
    | null
}
export interface MetricsReport {
  totalMetrics: number
  metricsByType: Record<string, number> | null
  collectors:
    | {
        name: string
        type: string
        metricsCount: number
        status: string
        lastCollection?: string
      }[]
    | null
  topMetrics: { name: string; type: string; value?: unknown }[] | null
}
export interface Trace {
  traceID: string
  rootSpanName: string
  spanCount: number
  durationMs: number
  status: string
  startTime: string
  protocol: string
}
export interface TraceDetail {
  trace_id: string
  duration: number
  spans:
    | {
        span_id: string
        name: string
        status: number
        duration: number
        depth: number
        offset_percent: number
        width_percent: number
        attributes: Record<string, string> | null
        http?: {
          request?: {
            headers?: Record<string, string> | null
            body?: string | null
          }
          response?: {
            headers?: Record<string, string> | null
            body?: string | null
          }
        } | null
      }[]
    | null
}
export interface AuditRecord {
  time: string
  contributor: string
  intent: string
  result: string
  latencyMs: number
  subject?: string
  user?: string
  correlationID?: string
}
export interface Extension {
  name: string
  displayName: string
  version: string
  description?: string
}
