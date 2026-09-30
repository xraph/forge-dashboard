import { Badge } from "@forge-go/dashboard-kit/components/badge"
import type { VerifyLevel } from "./types"

/*
 * Badge mapping for the chronicle pages, and why. All of it lives here so a
 * variant is never chosen at a call site.
 *
 * Outcome
 *   success is `outline`: it is nearly every row. failure and denied are
 *   `destructive`: an audit log is opened to find exactly those. Anything
 *   else a deployment records is shown as `outline` text, because an unknown
 *   value is not evidence of a fault.
 *
 * Severity
 *   info `outline`, warning `secondary` (notable, not wrong), critical
 *   `destructive`. Unknown values are `outline`.
 *
 * Coverage level
 *   keyed is `outline`, the ordinary state of a configured deployment.
 *   signed and anchored are `default`: the affirmative outcome, rare enough
 *   to stay a signal. unkeyed is `secondary`: notable but not wrong. It is
 *   the default deployment, and the page says what it cannot see in words,
 *   not in colour.
 *
 * Erased
 *   `secondary`. An erasure is a lawful GDPR action, not a fault.
 *
 * Key
 *   A destroyed key is `outline`: it is what nearly every erasure does, so
 *   that state recedes. A kept key is `secondary`: the erasure still marked
 *   the events erased and unreadable, but it is not yet cryptographic, which
 *   is notable and not wrong. Never `destructive`: nothing failed.
 *
 * Checkpoint check
 *   A check that held is `outline`, one that failed is `destructive`. A
 *   check that did not run gets no badge at all, only plain muted text. A
 *   badge means an opinion was formed.
 *
 * A chain break is deliberately not a badge. It is the finding, and it gets
 * the verdict sentence and the ribbon.
 */

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const variant = outcome === "failure" || outcome === "denied" ? "destructive" : "outline"
  return <Badge variant={variant}>{outcome}</Badge>
}

export function SeverityBadge({ severity }: { severity: string }) {
  const variant =
    severity === "critical" ? "destructive" : severity === "warning" ? "secondary" : "outline"
  return <Badge variant={variant}>{severity}</Badge>
}

export function CoverageBadge({ level }: { level: VerifyLevel }) {
  const variant =
    level === "signed" || level === "anchored" ? "default" : level === "unkeyed" ? "secondary" : "outline"
  return <Badge variant={variant}>{level}</Badge>
}

export function ErasedBadge() {
  return <Badge variant="secondary">Erased</Badge>
}

export function KeyBadge({ destroyed }: { destroyed: boolean }) {
  return destroyed ? <Badge variant="outline">Key destroyed</Badge> : <Badge variant="secondary">Key kept</Badge>
}

export function CheckHeldBadge({ children }: { children: string }) {
  return <Badge variant="outline">{children}</Badge>
}

export function CheckFailedBadge({ children }: { children: string }) {
  return <Badge variant="destructive">{children}</Badge>
}
