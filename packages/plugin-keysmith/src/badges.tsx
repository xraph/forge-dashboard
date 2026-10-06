import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { REASON_LABEL, STATE_LABEL } from "./format"
import type { KeySummary, RotationReason } from "./types"

/*
 * Badge mapping for key state. Whatever holds most rows is the quietest:
 * active is `outline`. Suspended is `default` because it is temporarily off
 * and worth a second look. Expired and revoked are `secondary`: they are
 * finished history and recede. An active key that expires within 7 days is
 * `destructive` ("Expires soon"), the one thing someone scans a key list to
 * find.
 */

const PENDING_NOTE =
  "not yet marked; Keysmith marks expiry when the key is next used"

export function KeyStateBadge({ summary }: { summary: KeySummary }) {
  const state = summary.effectiveState

  if (state === "active") {
    return summary.expiresSoon ? (
      <Badge variant="destructive">Expires soon</Badge>
    ) : (
      <Badge variant="outline">{STATE_LABEL.active}</Badge>
    )
  }

  if (state === "suspended") {
    return <Badge variant="default">{STATE_LABEL.suspended}</Badge>
  }

  if (state === "expired" && summary.expiryPending) {
    // The badge reads "Expired", but the stored state is still active until
    // the key is next used. Sighted users get the reason on hover, and a
    // screen reader gets it as text inside the badge.
    return (
      <Badge variant="secondary" title={`Expired, ${PENDING_NOTE}`}>
        {STATE_LABEL.expired}
        <span className="sr-only">, {PENDING_NOTE}</span>
      </Badge>
    )
  }

  // Revoked, marked-expired, and any state this page does not know by name.
  return (
    <Badge variant="secondary">{STATE_LABEL[state] ?? String(state)}</Badge>
  )
}

/*
 * Badge mapping for rotation reason. Manual and scheduled rotations are the
 * routine ones, and most rows, so they are `outline`. A policy rotation is
 * notable but not wrong: `secondary`. A compromise is the rotation somebody
 * scans this list to find: `destructive`. A reason this page does not know
 * by name shows as written, in an outline, rather than claiming a weight.
 */
const REASON_VARIANT: Record<
  RotationReason,
  "outline" | "secondary" | "destructive"
> = {
  manual: "outline",
  scheduled: "outline",
  policy: "secondary",
  compromise: "destructive",
}

function isKnownReason(reason: string): reason is RotationReason {
  return Object.hasOwn(REASON_LABEL, reason)
}

export function RotationReasonBadge({ reason }: { reason: string }) {
  if (!isKnownReason(reason)) {
    return <Badge variant="outline">{reason}</Badge>
  }
  return <Badge variant={REASON_VARIANT[reason]}>{REASON_LABEL[reason]}</Badge>
}
