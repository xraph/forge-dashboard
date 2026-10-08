import { Badge } from "@forge-go/dashboard-kit/components/badge"
import type { ErasureSummary, VerifyLevel } from "./types"

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
 * Erasure status
 *   completed is `outline`: it is nearly every erasure. pending is
 *   `destructive`: it did not finish, some keys may already be gone and not
 *   every key is confirmed destroyed, and it is what an operator opens the
 *   page to find.
 *
 * Key
 *   A destroyed key is `outline`: it is what nearly every completed erasure
 *   does, so that state recedes. A legacy key that was retained, and a key
 *   left intact, are `secondary`: the events are still marked erased and
 *   unreadable, but the erasure is not yet cryptographic, which is notable and
 *   not wrong. A pending erasure is `secondary` "Not confirmed": nothing is
 *   known about its keys, and that is not a fault of this row. Never
 *   `destructive`: the status column carries the failure.
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
  const variant =
    outcome === "failure" || outcome === "denied" ? "destructive" : "outline"
  return <Badge variant={variant}>{outcome}</Badge>
}

export function SeverityBadge({ severity }: { severity: string }) {
  const variant =
    severity === "critical"
      ? "destructive"
      : severity === "warning"
        ? "secondary"
        : "outline"
  return <Badge variant={variant}>{severity}</Badge>
}

export function CoverageBadge({ level }: { level: VerifyLevel }) {
  const variant =
    level === "signed" || level === "anchored"
      ? "default"
      : level === "unkeyed"
        ? "secondary"
        : "outline"
  return <Badge variant={variant}>{level}</Badge>
}

export function ErasedBadge() {
  return <Badge variant="secondary">Erased</Badge>
}

/** A record with no status, or one this build does not know, is completed, as the server reads old records. */
export function isPending(e: Pick<ErasureSummary, "status">): boolean {
  return e.status === "pending"
}

export function ErasureStatusBadge({ erasure }: { erasure: ErasureSummary }) {
  return isPending(erasure) ? (
    <Badge variant="destructive">Pending</Badge>
  ) : (
    <Badge variant="outline">Completed</Badge>
  )
}

export function KeyBadge({ erasure }: { erasure: ErasureSummary }) {
  if (isPending(erasure))
    return <Badge variant="secondary">Not confirmed</Badge>
  if (erasure.keyDestroyed)
    return <Badge variant="outline">Key destroyed</Badge>
  if (erasure.legacyKeyRetained)
    return <Badge variant="secondary">Legacy key retained</Badge>
  return <Badge variant="secondary">Key intact</Badge>
}

export function CheckHeldBadge({ children }: { children: string }) {
  return <Badge variant="outline">{children}</Badge>
}

export function CheckFailedBadge({ children }: { children: string }) {
  return <Badge variant="destructive">{children}</Badge>
}
