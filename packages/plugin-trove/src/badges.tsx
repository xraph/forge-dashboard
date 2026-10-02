import { Badge } from "@forge-go/dashboard-kit/components/badge"
import type { CasEntry, FlagStatus } from "./types"

/**
 * Proportion first, per the playbook. A flag configured and not applied is
 * what an operator came to the page to find, so it is the only destructive
 * state. The note beside the badge says where an applied flag applies.
 */
export function FlagStateBadge({ flag }: { flag: FlagStatus }) {
  if (flag.configured && !flag.applied) return <Badge variant="destructive">Configured, not applied</Badge>
  if (flag.applied) return <Badge variant="outline">Applied</Badge>
  return <Badge variant="secondary">Not configured</Badge>
}

export function HealthBadge({ ok }: { ok: boolean }) {
  return ok ? <Badge variant="outline">Healthy</Badge> : <Badge variant="destructive">Unhealthy</Badge>
}

/**
 * Indexed blobs with references are the majority in any running process. A
 * blob the index does not know is what a restart leaves behind, and what an
 * operator came to find.
 */
export function CasStateBadge({ entry }: { entry: CasEntry }) {
  if (!entry.indexed) return <Badge variant="destructive">Not indexed</Badge>
  if (entry.pinned) return <Badge variant="secondary">Pinned</Badge>
  if (entry.refCount === 0) return <Badge variant="default">GC candidate</Badge>
  return <Badge variant="outline">Indexed</Badge>
}

const STREAM_VARIANT: Record<string, "outline" | "secondary" | "default" | "destructive"> = {
  active: "outline",
  idle: "secondary",
  paused: "secondary",
  completing: "default",
  completed: "default",
  failed: "destructive",
  cancelled: "destructive",
}

export function StreamStateBadge({ state }: { state: string }) {
  return <Badge variant={STREAM_VARIANT[state] ?? "outline"}>{state}</Badge>
}
