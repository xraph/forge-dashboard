export interface ConfigDetail {
  maxGraphDepth: number
  maxGraphVisited: number
  maxGraphFanout: number
  maxBatchChecks: number
  cacheTtlSeconds: number
  cacheMaxSize: number
  rbacEnabled: boolean
  abacEnabled: boolean
  rebacEnabled: boolean
  checkLogEnabled: boolean
  requireTenant: boolean
  evaluateAllModels: boolean
  checkLogQueueSize: number
  checkLogRetentionHours: number
  maintenanceIntervalMinutes: number
}

export function WardenConfigPage() {
  return null
}
