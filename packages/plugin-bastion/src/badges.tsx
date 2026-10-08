import { Badge } from "@forge-go/dashboard-kit/components/badge"
import type { CircuitState, RouteProtocol, RouteSource } from "./types"

/*
 * Proportion first. On a working gateway most targets are healthy and most
 * breakers closed, so those take outline and recede. Half-open is the one
 * worth a second look (default); unhealthy and open are what somebody came
 * to find (destructive). A disabled route is notable, not wrong (secondary).
 * Sources and protocols are balanced labels, so outline.
 */

export function HealthBadge({ healthy }: { healthy: boolean }) {
  return (
    <Badge variant={healthy ? "outline" : "destructive"}>
      {healthy ? "Healthy" : "Unhealthy"}
    </Badge>
  )
}

const CIRCUIT: Record<
  CircuitState,
  { label: string; variant: "outline" | "default" | "destructive" }
> = {
  closed: { label: "Closed", variant: "outline" },
  half_open: { label: "Half-open", variant: "default" },
  open: { label: "Open", variant: "destructive" },
}

export function CircuitBadge({ state }: { state: CircuitState }) {
  const c = CIRCUIT[state] ?? CIRCUIT.closed
  return <Badge variant={c.variant}>{c.label}</Badge>
}

export function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge variant={enabled ? "outline" : "secondary"}>
      {enabled ? "Enabled" : "Disabled"}
    </Badge>
  )
}

const SOURCE: Record<RouteSource, string> = {
  manual: "Manual",
  farp: "FARP",
  discovery: "Discovery",
}

export function SourceBadge({ source }: { source: RouteSource }) {
  return <Badge variant="outline">{SOURCE[source] ?? source}</Badge>
}

export function ProtocolBadge({ protocol }: { protocol: RouteProtocol }) {
  return (
    <Badge variant="outline" className="font-mono text-xs">
      {protocol}
    </Badge>
  )
}
