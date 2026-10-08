// Development-only samples matching the Go pilot's JSON field names and units.
const services = [
  { name: "http-server", type: "Transport", status: "healthy" },
  { name: "postgres", type: "Database", status: "healthy" },
  { name: "redis", type: "Cache", status: "degraded" },
  { name: "event-bus", type: "Messaging", status: "healthy" },
  { name: "scheduler", type: "Worker", status: "healthy" },
]
const checks = services.map(service => ({ name: service.name, status: service.status, durationMs: service.name === "redis" ? 148 : 4, critical: service.name === "postgres", message: service.name === "redis" ? "Response time above threshold" : "" }))
const records = [
  { time: "2026-09-22T14:48:32Z", contributor: "auth", intent: "session.create", user: "operator", result: "success", latencyMs: 12, correlationID: "req-001" },
  { time: "2026-09-22T14:46:18Z", contributor: "auth", intent: "roles.update", user: "operator", result: "success", latencyMs: 8, correlationID: "req-002" },
]
export const coreFixtures = {
  "services.list": { kind: "query", handler: () => ({ services }) },
  "services.detail": { kind: "query", handler: ({ name }) => ({ ...services.find(service => service.name === name), health: { status: name === "redis" ? "degraded" : "healthy", message: name === "redis" ? "Response time above threshold" : "Connection established", duration: 148000000, critical: false }, metrics: { connections: 18 }, dependencies: ["configuration"], last_health_check: "2026-09-22T14:50:00Z", uptime: 86400000000000 }) },
  health: { kind: "query", handler: () => ({ overallStatus: "degraded", healthySummary: 4, total: 5, services: checks }) },
  "metrics-report": { kind: "query", handler: () => ({ totalMetrics: 128, metricsByType: { counter: 68, gauge: 42, histogram: 18 }, collectors: [{ name: "runtime", type: "Go", metricsCount: 128, status: "active", lastCollection: "2026-09-22T14:50:00Z" }], topMetrics: [{ name: "http.requests.total", type: "counter", value: 128430 }, { name: "runtime.goroutines", type: "gauge", value: 42 }, { name: "db.connections.active", type: "gauge", value: 18 }] }) },
  "traces.list": { kind: "query", handler: () => ({ total: 2, traces: [
    { traceID: "trace-001", rootSpanName: "GET /api/users", spanCount: 2, durationMs: 42, status: "ok", startTime: "2026-09-22T14:48:32Z", protocol: "REST" },
    { traceID: "trace-002", rootSpanName: "POST /api/sessions", spanCount: 1, durationMs: 148, status: "error", startTime: "2026-09-22T14:48:22Z", protocol: "REST" },
  ] }) },
  "traces.detail": { kind: "query", handler: ({ id }) => ({ trace_id: id, duration: 42000000, spans: [
    { span_id: "span-001", name: "HTTP request", status: 1, duration: 42000000, depth: 0, offset_percent: 0, width_percent: 100, attributes: { "http.method": "GET" }, http: { request: { headers: { Accept: "application/json", "X-Request-Id": "req_42" } }, response: { headers: { "Content-Type": "application/json", "Cache-Control": "private" }, body: JSON.stringify({ users: [{ id: "usr_1", name: "Ada" }] }) } } },
    { span_id: "span-002", name: "Database query", status: 1, duration: 12000000, depth: 1, offset_percent: 20, width_percent: 28.57, attributes: { "db.system": "postgresql" } },
  ] }) },
  "audit.list": { kind: "query", handler: ({ limit = 200 } = {}) => ({ records: records.slice(0, limit), total: Math.min(records.length, limit) }) },
  "extensions.list": { kind: "query", handler: () => ({ extensions: [ { name: "auth", displayName: "Authsome", version: "0.9.0", pageCount: 13, widgetCount: 2 }, { name: "streaming-contract", displayName: "Streaming", version: "0.6.0", pageCount: 6, widgetCount: 1 } ] }) },
}
