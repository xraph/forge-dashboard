import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { statusLabel } from "./format"
import type { MessageStatus, Protection } from "./wire"

/*
 * Badge mapping for the herald pages, and why. Colour is an attention budget:
 * whatever holds most rows takes `outline` and recedes, `destructive` is kept
 * for what somebody opened the page to find.
 *
 * Message status
 *   sent is `outline`: it is the majority on any working install. It reads
 *   "Accepted by provider", never "delivered": Herald hands the message over
 *   and hears nothing back.
 *   sending and suppressed are `secondary`: notable, not wrong. Suppressed
 *   means the user opted out, which is the system working.
 *   failed is `destructive`: it is what you came to the log to find.
 *   queued and delivered are `outline` and bounced is `destructive`. Herald
 *   never writes those three today; they are mapped so a future writer does
 *   not render a blank.
 *   Anything else shows as it came, `outline`.
 *
 * Enabled
 *   Enabled is `outline`, disabled `secondary`: a disabled provider or
 *   template is a deliberate state, not a fault.
 *
 * Credential protection
 *   Encrypted is `outline` and plaintext `secondary`, deliberately not
 *   `destructive`. How much of an install is plaintext depends on the
 *   deployment, and on the installs that most need the warning every row
 *   would be red and the colour would mean nothing. The warning lives in one
 *   callout on the providers page and the overview's posture panel instead.
 *   "Encrypted" appears only on a value carrying the aes-256-gcm marker.
 *
 * Version
 *   Live is `outline`, inactive `secondary`.
 *
 * Dangling provider
 *   `destructive`: a routing rule naming a deleted provider skips that rule
 *   at send time, which nobody intends.
 *
 * Disabled provider, in a send
 *   `default`: worth a second look before a test send, not a failure.
 *
 * Channels are plain text, never a badge: a channel is a category, not a
 * signal.
 */

const STATUS_VARIANT: Record<MessageStatus, "outline" | "secondary" | "destructive"> = {
  sent: "outline",
  sending: "secondary",
  suppressed: "secondary",
  failed: "destructive",
  queued: "outline",
  delivered: "outline",
  bounced: "destructive",
}

export function MessageStatusBadge({ status }: { status: MessageStatus }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "outline"}>{statusLabel(status)}</Badge>
}

export function EnabledBadge({ enabled }: { enabled: boolean }) {
  return <Badge variant={enabled ? "outline" : "secondary"}>{enabled ? "Enabled" : "Disabled"}</Badge>
}

export function ProtectionBadge({ protection }: { protection: Protection }) {
  return protection === "aes-256-gcm" ? <Badge variant="outline">Encrypted</Badge> : <Badge variant="secondary">Plaintext</Badge>
}

export function VersionBadge({ active }: { active: boolean }) {
  return <Badge variant={active ? "outline" : "secondary"}>{active ? "Live" : "Inactive"}</Badge>
}

export function DanglingBadge() {
  return <Badge variant="destructive">Provider deleted</Badge>
}

export function DisabledProviderBadge() {
  return <Badge variant="default">Provider disabled</Badge>
}
