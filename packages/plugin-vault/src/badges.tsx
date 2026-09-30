import { Badge } from "@forge-go/dashboard-kit/components/badge"

/*
 * Badge mapping for the vault pages, and why. Every surface that shows a
 * secret or a rotation policy uses these three components, so the mapping
 * lives in one place.
 *
 * Encryption
 *   A non-empty algorithm shows the algorithm's name (for example
 *   "AES-256-GCM") with `outline`.
 *   An empty algorithm shows the text "Not encrypted" with `destructive`.
 *   The majority state is not knowable at design time: a keyless deployment
 *   is all unencrypted and a keyed one is mostly encrypted. So this is a
 *   stable semantic mapping, not a "highlight the rare one" mapping, and "not
 *   encrypted" is the state an operator opens the page to find. For an empty
 *   algorithm the words "encrypted", "secure" and "protected" never appear
 *   outside the phrase "Not encrypted": the row holds its value in the clear
 *   and the badge must not suggest otherwise.
 *
 * Policy status
 *   Enabled is `outline`, disabled is `secondary`. Neither is an error, and
 *   a disabled policy is a deliberate state that recedes.
 *
 * Rotator
 *   A registered rotator is `default` ("Rotator registered"). None is
 *   `outline` ("No rotator"). Most secrets have no rotator, so the common
 *   case recedes and the exception stands out.
 *
 * Flags
 *   Enabled is `outline` ("On"), disabled is `secondary` ("Off"): a flag that
 *   is off is a deliberate state, not a fault. The type is an `outline` in
 *   mono, since it is a raw value an operator might copy. A default that does
 *   not match its declared type is `destructive` ("Wrong type"): the flag
 *   will not evaluate the way its type promises, which is what an operator
 *   opens the page to find, and it is rare.
 *
 * Config
 *   The type is an `outline` in mono, as for flags. A type outside the six the
 *   vault understands adds an "Unsupported type" `secondary` beside it: the
 *   entry is real and stays listed, its value cannot be edited here, and that
 *   is a fact about the row rather than a fault. A stored value that does not
 *   match its type reuses the destructive "Wrong type" flags use.
 *
 * Rules and evaluation
 *   A rule that can never match is `secondary` ("Never matches"). When a flag
 *   is evaluated, the rung that decided the answer is `default` ("Decided
 *   here"), the one worth a second look. Rungs below it are `secondary`
 *   ("Not reached"). Nothing on the ladder is `destructive`: nothing on it is
 *   an error.
 */

export function EncryptionBadge({ alg }: { alg: string }) {
  if (alg === "") {
    return <Badge variant="destructive">Not encrypted</Badge>
  }
  return <Badge variant="outline">{alg}</Badge>
}

export function PolicyStatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge variant={enabled ? "outline" : "secondary"}>
      {enabled ? "Enabled" : "Disabled"}
    </Badge>
  )
}

export function RotatorBadge({ rotatable }: { rotatable: boolean }) {
  return rotatable ? (
    <Badge variant="default">Rotator registered</Badge>
  ) : (
    <Badge variant="outline">No rotator</Badge>
  )
}

export function FlagEnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge variant={enabled ? "outline" : "secondary"}>
      {enabled ? "On" : "Off"}
    </Badge>
  )
}

export function FlagTypeBadge({ type }: { type: string }) {
  return (
    <Badge variant="outline" className="font-mono text-xs">
      {type}
    </Badge>
  )
}

export function ConfigTypeBadge({ type }: { type: string }) {
  return (
    <Badge variant="outline" className="font-mono text-xs">
      {type}
    </Badge>
  )
}

export function UnsupportedTypeBadge() {
  return <Badge variant="secondary">Unsupported type</Badge>
}

export function WrongTypeBadge() {
  return <Badge variant="destructive">Wrong type</Badge>
}

export function NeverMatchesBadge() {
  return <Badge variant="secondary">Never matches</Badge>
}

export function DecidedHereBadge() {
  return <Badge variant="default">Decided here</Badge>
}

export function NotReachedBadge() {
  return <Badge variant="secondary">Not reached</Badge>
}

/*
 * Audit
 *   The resource an entry is about is `secondary` in mono: a raw value
 *   ("secret", "rotation") that labels the row and asks for no attention.
 *   The outcome is `outline` for success and `destructive` for failure. Most
 *   rows succeed, so the common case recedes and the failure an operator opens
 *   the page to find stands out. An outcome the dashboard does not know is
 *   shown as it came, `outline`, rather than dressed up as either.
 */

export function ResourceBadge({ resource }: { resource: string }) {
  return (
    <Badge variant="secondary" className="font-mono text-xs">
      {resource}
    </Badge>
  )
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  return (
    <Badge variant={outcome === "failure" ? "destructive" : "outline"}>
      {outcome}
    </Badge>
  )
}
