// Wire types for the sentinel contract. Field names are the Go JSON tags in
// sentinel/extension/contract (handlers_*.go), not a summary of them. A field
// marked optional is one Go omits when empty; everything else is always sent.
// Timestamps are RFC3339 in UTC with whole seconds. Scores and rates are
// numbers from 0 to 1.

/** A suite's current prompt version, by id and number. */
export interface VersionRef {
  id: string
  version: number
}

/** A baseline as other records point at it. */
export interface BaselineRef {
  id: string
  name: string
  passRate: number
}

export interface Suite {
  id: string
  name: string
  description: string
  model: string
  /** 0 means "not set": a run then uses the engine's temperature. */
  temperature: number
  personaRef?: string
  /** Always the suite's own prompt, even when a version is current. */
  systemPrompt: string
  promptSource: "version" | "suite"
  currentPromptVersion?: VersionRef
  currentBaseline?: BaselineRef
  caseCount: number
  createdAt: string
  updatedAt: string
}

export interface SuitesList {
  items: Suite[]
}

/**
 * A scorer config value the server withheld: a not_contains substring. The
 * server withholds every not_contains substring on a case whose context has an
 * attack_type (leakage and injection cases alike), never keyed on the
 * "redteam" tag, which an operator can edit.
 */
export interface Redaction {
  key: string
  /** Characters, counted as Go counts runes. */
  length: number
}

export interface ScorerConfig {
  name: string
  /**
   * Never null. A redacted key is missing from here. On a case whose context
   * has an attack_type, every not_contains substring is redacted.
   */
  config: Record<string, unknown>
  redacted?: Redaction
}

export interface RedTeamRef {
  attackType: string
}

export interface TestCase {
  id: string
  suiteId: string
  name: string
  input: string
  expected?: string
  scenarioType: string
  tags: string[]
  scorers: ScorerConfig[]
  context: Record<string, unknown>
  metadata: Record<string, unknown>
  /** Present when the case carries the exact tag "redteam". */
  redTeam?: RedTeamRef
  createdAt: string
  updatedAt: string
}

export interface CasesList {
  items: TestCase[]
}

export interface PromptVersion {
  id: string
  suiteId: string
  version: number
  systemPrompt: string
  changelog?: string
  isCurrent: boolean
  /** Runs of any state that recorded this version. */
  runCount: number
  /** The newest completed run's pass rate; absent with no completed run. */
  latestPassRate?: number
  createdAt: string
}

export interface PromptVersionsList {
  items: PromptVersion[]
}

/** prompts.detail: the version, plus the one before it for the diff. */
export interface PromptVersionDetail extends PromptVersion {
  previous?: PromptVersion
}

export interface TargetInfo {
  name: string
  description: string
}

export interface ScorerInfo {
  name: string
  description: string
  dimension?: string
  usesLlm: boolean
  /** True when the scorer cannot run without config (regex, length, ...). */
  requiresConfig: boolean
}

export interface SentinelConfig {
  defaultModel: string
  temperature: number
  passThreshold: number
  regressionThreshold: number
  concurrency: number
  targets: TargetInfo[]
  scorers: ScorerInfo[]
}

/** cases.import's answer. */
export interface ImportResult {
  imported: number
}
