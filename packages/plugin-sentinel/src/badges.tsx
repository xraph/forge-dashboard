import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { scenarioLabel } from "./format"

// Badge colour is an attention budget (PLAYBOOK, convention 5). The mappings
// below are the spec's "Badges" table, with its reasons:
//
// - Scenario: almost every case is "standard", so standard takes outline and
//   recedes; the other seven are notable but not wrong, so secondary.
// - Markers ("Current", "Red team"): default. They are rare on any page and
//   are the thing worth a second look on the row that carries them.
// - "Calls an LLM": default. Few scorers call a model, and those cost money a
//   run does not meter, so only they get the loud badge.
// - "Needs config": secondary. Notable, not wrong: such a scorer can only be
//   attached to a case, with its settings.

export function ScenarioBadge({ type }: { type: string }) {
  return (
    <Badge variant={type === "standard" ? "outline" : "secondary"}>
      {scenarioLabel(type)}
    </Badge>
  )
}

export function CurrentBadge() {
  return <Badge variant="default">Current</Badge>
}

/** A red-team case's marker, with its attack type. */
export function RedTeamBadge({ attackType }: { attackType: string }) {
  return (
    <Badge variant="default">
      Red team<span className="font-mono text-xs">· {attackType}</span>
    </Badge>
  )
}

/** A scorer that calls a model, and so costs money a run does not meter. */
export function LlmBadge() {
  return <Badge variant="default">Calls an LLM</Badge>
}

/** A scorer that cannot run without config of its own. */
export function NeedsConfigBadge() {
  return <Badge variant="secondary">Needs config</Badge>
}
