export interface OverviewStats {
  roles: number
  permissions: number
  assignments: number
  relations: number
  policies: number
  resourceTypes: number
}

export interface CheckSummary {
  id: string
  namespacePath: string
  subjectKind: string
  subjectId: string
  action: string
  resourceType: string
  resourceId: string
  decision: string
  reason?: string
  evalTimeNs: number
  cached: boolean
  error?: string
  createdAt: string
}

export interface RecentChecks {
  checks: CheckSummary[]
}

export function WardenOverviewPage() {
  return null
}
