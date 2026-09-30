export type RouteSource = "manual" | "farp" | "discovery"
export type RouteProtocol = "http" | "websocket" | "sse" | "grpc" | "graphql"
export type CircuitState = "closed" | "open" | "half_open"

export interface RouteSummary {
  id: string
  path: string
  /** Empty means any method. */
  methods: string[]
  protocol: RouteProtocol
  source: RouteSource
  serviceName: string
  /** Effective priority, as the route table sorts it. */
  priority: number
  enabled: boolean
  targetCount: number
  healthyTargets: number
  editable: boolean
  /** Defined in the gateway's config file. */
  config: boolean
  updatedAt: string
}

export interface RoutesList {
  routes: RouteSummary[]
  total: number
}

export interface TargetStats {
  activeConns: number
  totalRequests: number
  totalErrors: number
  avgLatencyMs: number
}

export interface TargetView {
  id: string
  url: string
  weight: number
  tags: string[]
  healthy: boolean
  circuitState: CircuitState
  stats: TargetStats
  tls: boolean
  healthCheckPath?: string
  openapi?: string
  metadataKeys: string[]
}

export interface HeaderPolicy {
  add?: Record<string, string>
  set?: Record<string, string>
  remove?: string[]
}

export interface RouteDetail extends RouteSummary {
  /** Manual routes only: path and priority as the operator entered them. */
  input?: { path: string; priority: number }
  stripPrefix: boolean
  addPrefix: string
  rewritePath: string
  headers: HeaderPolicy
  retry?: Record<string, unknown>
  timeout?: Record<string, unknown>
  rateLimit?: Record<string, unknown>
  auth?: Record<string, unknown>
  circuitBreaker?: Record<string, unknown>
  cache?: Record<string, unknown>
  trafficPolicy?: Record<string, unknown>
  transform?: { requestHeaders: HeaderPolicy; responseHeaders: HeaderPolicy }
  metadataKeys: string[]
  version: number
  createdAt: string
  targets: TargetView[]
}

export interface UpstreamRoute {
  routeId: string
  path: string
  targetId: string
}

export interface Upstream {
  url: string
  healthy: boolean
  circuitState: CircuitState
  activeConns: number
  totalRequests: number
  totalErrors: number
  avgLatencyMs: number
  routes: UpstreamRoute[]
}

export interface UpstreamsList {
  upstreams: Upstream[]
  total: number
}

export interface TopRoute {
  routeId: string
  path: string
  totalRequests: number
  totalErrors: number
}

export interface OverviewStats {
  totalRequests: number
  totalErrors: number
  errorRate: number | null
  avgLatencyMs: number | null
  p99LatencyMs: number | null
  latencySamples: number
  cacheLookups: number
  cacheHitRate: number | null
  rateLimited: number
  circuitBreaks: number
  totalRoutes: number
  enabledRoutes: number
  healthyUpstreams: number
  totalUpstreams: number
  openCircuits: number
  halfOpenCircuits: number
  circuitBreakerEnabled: boolean
  discoveryEnabled: boolean
  startedAt: string | null
  uptimeSeconds: number
  topRoutes: TopRoute[]
}

export interface RouteTraffic {
  routeId: string
  path: string
  totalRequests: number
  totalErrors: number
  errorRate: number | null
  avgLatencyMs: number | null
  p99LatencyMs: number | null
  latencySamples: number
}

export interface TrafficStats {
  totalRequests: number
  totalErrors: number
  rateLimited: number
  circuitBreaks: number
  cacheHits: number
  cacheMisses: number
  /** False means nothing retries, so a retry count would be a fake zero. */
  retriesMeasured: boolean
  avgLatencyMs: number | null
  p99LatencyMs: number | null
  latencySamples: number
  /** Busiest first. */
  routes: RouteTraffic[]
  total: number
}

export interface CircuitView {
  targetId: string
  url: string
  routes: UpstreamRoute[]
  /** False means never selected, so no breaker exists yet. */
  tracked: boolean
  state: CircuitState
  failureCount: number
  lastFailure: string | null
  lastStateChange: string | null
}

export interface CircuitsList {
  enabled: boolean
  failureThreshold: number
  resetTimeoutSeconds: number
  halfOpenMax: number
  /** By target id. */
  circuits: CircuitView[]
  total: number
}

export interface ServiceView {
  name: string
  version: string
  address: string
  port: number
  protocols: string[]
  healthy: boolean
  routeCount: number
  discoveredAt: string | null
  metadataKeys: string[]
}

export interface ServicesList {
  discoveryEnabled: boolean
  /** By name. */
  services: ServiceView[]
  total: number
}

export interface SpecView {
  serviceName: string
  version: string
  specUrl: string
  healthy: boolean
  pathCount: number
  error?: string
  fetchedAt: string | null
}

export interface OpenAPISummary {
  /** Configured. */
  enabled: boolean
  /** Aggregator started. */
  running: boolean
  specPath: string
  lastRefresh: string | null
  totalPaths: number
  services: SpecView[]
  total: number
}

export interface ConfigSetting {
  key: string
  value: string
}

export interface ConfigSection {
  id: string
  title: string
  /** Null means the section has no switch. */
  enabled: boolean | null
  note?: string
  settings: ConfigSetting[]
}

export interface ConfigDetail {
  sections: ConfigSection[]
}
