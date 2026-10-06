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

export function runPath(runId: string): string {
  return `/runs/${encodeURIComponent(runId)}`
}

export function resultPath(runId: string, resultId: string): string {
  return `${runPath(runId)}/results/${encodeURIComponent(resultId)}`
}

export function baselinePath(baselineId: string): string {
  return `/baselines/${encodeURIComponent(baselineId)}`
}

/** A suite page on one of its tabs. "cases" is the plain suite path. */
export function suiteTabPath(suiteId: string, tab: "cases" | "prompts" | "runs" | "baselines"): string {
  return tab === "cases" ? suitePath(suiteId) : `${suitePath(suiteId)}/${tab}`
}

/**
 * A signed change on the 0 to 1 scale, with a real minus sign: "+0.04",
 * "−0.08", "0.00".
 */
export function formatDelta(value: number): string {
  const fixed = Math.abs(value).toFixed(2)
  if (fixed === "0.00") return "0.00"
  return value < 0 ? `−${fixed}` : `+${fixed}`
}

/** What a target reported, in dollars to four places. */
export function formatCost(value: number): string {
  return `$${value.toFixed(4)}`
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US")
}

export function formatLatency(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** "4m 12s", "38s", "1h 3m": how long between two timestamps. */
export function formatDuration(fromIso: string, toIso: string): string {
  const seconds = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** "8 s ago", "3 min ago", "2 h ago", from a timestamp to now. */
export function ago(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (seconds < 60) return `${seconds} s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.floor(minutes / 60)} h ago`
}

/** A run id as people read it in a heading: the prefix and the last six characters. */
export function shortRunId(runId: string): string {
  return runId.length > 12 ? `${runId.slice(0, runId.indexOf("_") + 1)}…${runId.slice(-6)}` : runId
}
