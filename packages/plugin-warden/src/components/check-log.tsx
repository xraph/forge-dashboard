import { PluginLink } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import type { Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { NamespaceCell } from "./namespace-filter"
import { SubjectLink } from "./subject-link"

/** Mirrors the Go `CheckLogSummary`. Field names are its JSON tags. */
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

/** One rule that contributed to a decision. Mirrors the Go `CheckLogMatch`. */
export interface CheckMatch {
  source: string
  ruleId?: string
  detail?: string
}

/** Mirrors the Go `CheckLogDetail`: the summary plus what an auditor reads. */
export interface CheckDetail extends CheckSummary {
  appId?: string
  matchedBy: CheckMatch[]
  obligations: string[]
  requestIp?: string
  requestId?: string
  traceId?: string
}

/**
 * Mirrors the Go `CheckLogsListResponse`. `notRecorded` is absent when check
 * logging is off, and its counts are per server process across every tenant,
 * because the writer's queue is shared.
 */
export interface CheckLogList {
  items: CheckSummary[]
  total: number
  limit: number
  offset: number
  notRecorded?: { queueFull: number; writeFailed: number; since: string }
}

/**
 * Every decision warden accepts as a filter, in the order the filter lists them.
 *
 * The engine as it stands never writes `deny` or `deny_condition`, so
 * choosing one shows the filtered-empty state, which is true.
 */
export const DECISIONS = [
  "allow",
  "deny",
  "deny_explicit",
  "deny_default",
  "deny_no_roles",
  "deny_no_perms",
  "deny_condition",
  "deny_relation",
  "error",
] as const

/**
 * The closed set of subject kinds the server accepts. The same four literals
 * are `SUBJECT_KINDS` in `pages/assignments.tsx`; that copy is not exported,
 * and moving it would touch a page this feature does not otherwise change.
 */
export const CHECK_SUBJECT_KINDS = [
  "user",
  "api_key",
  "service",
  "service_acct",
] as const

/**
 * The check log's scan signal is not the decision.
 *
 * Allow-versus-deny volume is a property of the deployment rather than the
 * domain: a permissive system logs mostly allows and the denials are the
 * interesting minority, a restrictive one is the reverse, and both are
 * ordinary. So the decision badge takes a stable mapping and the page
 * accepts that it is weak. Error is the one state whose meaning does not
 * vary with posture, so it is the one that interrupts.
 */
export function decisionVariant(
  decision: string
): "outline" | "secondary" | "destructive" {
  if (decision === "error") return "destructive"
  return decision === "allow" ? "outline" : "secondary"
}

/**
 * A duration in nanoseconds, in the unit that keeps it readable. From 100,000 ns
 * up it is milliseconds with two decimals ("0.41 ms"). From 1000 ns up to that
 * it is microseconds with one decimal ("1.8 µs"), because a cached lookup takes
 * a few microseconds and would otherwise read as "0.00 ms". Below 1000 ns it is
 * the plain count ("640 ns").
 */
export function formatEvalTime(ns: number): string {
  if (ns >= 100_000) return `${(ns / 1_000_000).toFixed(2)} ms`
  if (ns >= 1_000) return `${(ns / 1_000).toFixed(1)} µs`
  return `${ns} ns`
}

/**
 * The request a check answered, read left to right: who, what, on which
 * resource. The identifiers are mono, because an id is something an operator
 * copies. No arrow between them, since none of the three is a direction.
 */
export function CheckRequestLine({ check }: { check: CheckSummary }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <SubjectLink
        kind={check.subjectKind}
        id={check.subjectId}
        className="font-mono text-xs"
      />
      <span>{check.action}</span>
      <span className="font-mono text-xs">{`${check.resourceType}:${check.resourceId}`}</span>
    </span>
  )
}

/**
 * The columns the overview's recent checks and the check log share, so a row
 * reads the same wherever it is met. When comes first and links to the
 * check's own page.
 */
export function checkColumns(): Column<CheckSummary>[] {
  return [
    {
      id: "createdAt",
      header: "When",
      cell: (c) => (
        <PluginLink
          to={`/check-log/${c.id}`}
          className="underline underline-offset-4"
        >
          <Timestamp value={c.createdAt} label="checked at" />
        </PluginLink>
      ),
    },
    {
      id: "subject",
      header: "Subject",
      cell: (c) => (
        <SubjectLink
          kind={c.subjectKind}
          id={c.subjectId}
          className="font-medium"
        />
      ),
      className: "font-medium",
    },
    { id: "action", header: "Action", cell: (c) => c.action },
    {
      id: "resource",
      header: "Resource",
      cell: (c) => (
        <span className="font-mono text-xs">{`${c.resourceType}:${c.resourceId}`}</span>
      ),
    },
    {
      id: "namespace",
      header: "Namespace",
      cell: (c) => <NamespaceCell path={c.namespacePath} />,
    },
    {
      id: "decision",
      header: "Decision",
      cell: (c) => (
        <Badge variant={decisionVariant(c.decision)}>{c.decision}</Badge>
      ),
    },
    {
      id: "detail",
      header: "Detail",
      // The bar is "every failure is visible to a person": an error badge
      // that does not say what happened is half of that. `error` always
      // wins when present, because it is the one state that interrupts;
      // `reason` explains an ordinary deny; a row with neither (a plain
      // allow, most of them) means none.
      cell: (c) =>
        c.error ? (
          <span className="text-destructive">{c.error}</span>
        ) : c.reason ? (
          <span className="text-muted-foreground">{c.reason}</span>
        ) : (
          <NoneCell label="detail" />
        ),
    },
    {
      id: "cached",
      header: "Cached",
      // Most checks are not cached, so "not cached" is the majority and
      // takes `outline`; `cached` is the minority worth the stronger signal,
      // since it is the most common real answer to "why did my permission
      // change not take effect". Never a blank cell for either state, per
      // this table's own convention (see `devices.tsx`'s trusted column).
      cell: (c) => (
        <Badge variant={c.cached ? "secondary" : "outline"}>
          {c.cached ? "cached" : "not cached"}
        </Badge>
      ),
    },
  ]
}
