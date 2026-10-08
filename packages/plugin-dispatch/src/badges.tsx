import { Badge } from "@forge-go/dashboard-kit/components/badge"
import type { JobState, RunState } from "./types"

const jobVariants = {
  completed: "outline",
  cancelled: "outline",
  pending: "secondary",
  running: "default",
  retrying: "default",
  failed: "destructive",
} as const
export function JobStateBadge({ state }: { state: JobState }) {
  return <Badge variant={jobVariants[state] ?? "outline"}>{state}</Badge>
}
export function RunStateBadge({ state }: { state: RunState }) {
  return (
    <Badge
      variant={
        state === "failed"
          ? "destructive"
          : state === "running"
            ? "default"
            : "outline"
      }
    >
      {state}
    </Badge>
  )
}
export function ReplayBadge({ replayed }: { replayed: boolean }) {
  return (
    <Badge variant={replayed ? "secondary" : "outline"}>
      {replayed ? "Replayed" : "Not replayed"}
    </Badge>
  )
}
export function CronBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge variant={enabled ? "outline" : "secondary"}>
      {enabled ? "Enabled" : "Disabled"}
    </Badge>
  )
}
export function HeartbeatBadge({
  status,
}: {
  status: "unknown" | "recent" | "silent"
}) {
  return (
    <Badge variant={status === "silent" ? "destructive" : "outline"}>
      {status === "recent"
        ? "Recent heartbeat"
        : status === "silent"
          ? "Silent"
          : "Heartbeat unknown"}
    </Badge>
  )
}
