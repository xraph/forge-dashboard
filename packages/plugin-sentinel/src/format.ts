// Paths and formatting shared by the pages. Paths are scope-relative: the host
// decides where the plugin is mounted, so nothing here says /@sentinel.

export function suitePath(suiteId: string): string {
  return `/suites/${encodeURIComponent(suiteId)}`
}

export function casePath(suiteId: string, caseId: string): string {
  return `${suitePath(suiteId)}/cases/${encodeURIComponent(caseId)}`
}

export function versionPath(suiteId: string, versionId: string): string {
  return `${suitePath(suiteId)}/prompts/${encodeURIComponent(versionId)}`
}

/**
 * A score or a rate, on the 0 to 1 scale the server sends. Two decimals, the
 * way the spec writes them ("pass rate 0.82"), never a percentage: a delta of
 * 0.08 against a threshold of 0.05 is the comparison people make, and
 * percentages would turn it into "8 points" against "5%".
 */
export function formatScore(value: number): string {
  return value.toFixed(2)
}

/** The eight scenario types the engine accepts, in its order. */
export const SCENARIO_TYPES = [
  "standard",
  "skill_challenge",
  "trait_probe",
  "behavior_trigger",
  "cognitive_stress",
  "comms_adaptation",
  "perception_test",
  "persona_coherence",
] as const

/** "skill_challenge" as an operator reads it: "Skill challenge". */
export function scenarioLabel(type: string): string {
  const words = type.replace(/_/g, " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * A suite's temperature as a person reads it. Zero is "not set" to the
 * engine, which then uses its own configured temperature, so it is shown as
 * that rather than as a temperature of zero.
 */
export function temperatureLabel(temperature: number): string {
  return temperature === 0 ? "Engine default" : String(temperature)
}

/** "1 case", "8 cases". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}
