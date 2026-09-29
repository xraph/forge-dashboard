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
