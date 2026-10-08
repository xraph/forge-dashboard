import { Badge } from "@forge-go/dashboard-kit/components/badge"
import type { KeyStatus, Outcome, TenantStatus } from "./types"

const tenantVariants = {
  active: "outline",
  disabled: "secondary",
  suspended: "destructive",
} as const
const keyVariants = {
  active: "outline",
  revoked: "secondary",
  expired: "default",
} as const
const outcomeVariants = {
  ok: "outline",
  cached: "secondary",
  blocked: "default",
  refused: "default",
  error: "destructive",
} as const

export function TenantBadge({ status }: { status: TenantStatus }) {
  return <Badge variant={tenantVariants[status]}>{status}</Badge>
}
export function KeyBadge({ status }: { status: KeyStatus }) {
  return <Badge variant={keyVariants[status]}>{status}</Badge>
}
export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  return <Badge variant={outcomeVariants[outcome]}>{outcome}</Badge>
}
