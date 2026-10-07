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

// Runs, results, regression, baselines and the overview (plan 4b).

/** What a run recorded when it started. A key is absent when it was not recorded. */
export interface RunSettings {
  passThreshold?: number
  regressionThreshold?: number
  concurrency?: number
  target?: string
  /** As requested, order and duplicates kept. */
  scorers?: string[]
  model?: string
  promptVersionId?: string
}

export type RunState = "running" | "completed" | "failed" | "cancelled"

export interface Run {
  id: string
  suiteId: string
  suiteName: string
  model: string
  temperature: number
  state: RunState
  /** Cases planned when the run started. */
  totalCases: number
  /** Results stored so far. */
  completedCases: number
  passed: number
  failed: number
  errored: number
  /** Passed over results stored, so errors and fails both lower it. */
  passRate: number
  avgScore: number
  avgLatencyMs: number
  totalTokens: number
  /** What the target reported. LLM-judge calls are not metered. */
  totalCost: number
  dimensionScores: Record<string, number>
  settings: RunSettings
  /** Set only on a failed run: why it failed. */
  error?: string
  createdAt: string
  completedAt?: string
  /** runs.detail only: when the newest result was stored. */
  lastProgressAt?: string
}

export interface RunsList {
  items: Run[]
  hasMore: boolean
}

export type ResultStatus = "pass" | "fail" | "error"

export interface ResultRow {
  id: string
  caseId: string
  /** The case's name when the run scored it. */
  caseName: string
  status: ResultStatus
  score: number
  latencyMs: number
  tokensUsed: number
  cost: number
  dimensionScores: Record<string, number>
  /** From the case as it is now: absent when the case was deleted or is not red team. */
  redTeam?: RedTeamRef
  /** The target's or a scorer's error text. */
  error?: string
}

export interface ResultCounts {
  pass: number
  fail: number
  error: number
}

export interface RunResults {
  items: ResultRow[]
  /** Every result of the run, whatever the status filter. */
  counts: ResultCounts
}

export interface ScorerResult {
  scorerName: string
  score: number
  passed: boolean
  reason: string
  dimension?: string
  details?: Record<string, unknown>
}

export interface TraceStep {
  index: number
  type: string
  output: string
  tokensUsed: number
}

export interface ToolCall {
  toolName: string
  arguments: string
  result: string
  error?: string
}

export interface RunTrace {
  steps: TraceStep[]
  toolCalls: ToolCall[]
}

export interface ResultDetail extends ResultRow {
  output: string
  /** Characters, counted as Go counts runes. */
  outputLength: number
  scorerResults: ScorerResult[]
  runTrace?: RunTrace
}

export interface RegressedCase {
  caseId: string
  caseName: string
  oldScore: number
  newScore: number
  delta: number
}

export interface CaseName {
  caseId: string
  caseName: string
}

export type RegressionReason = "runFailed" | "runCancelled" | "otherSuite" | "unknownState"

/**
 * The regression answer, an explicit state machine. Every state carries the
 * collections, empty; baseline, threshold, thresholdSource and worstDelta come
 * only with "compared".
 */
export interface Regression {
  state: "running" | "notComparable" | "noBaseline" | "compared"
  reason?: RegressionReason
  baseline?: BaselineRef
  threshold?: number
  thresholdSource?: "override" | "run" | "config"
  hasRegression: boolean
  /** Never above zero. */
  worstDelta?: number
  passRateDelta: number
  avgScoreDelta: number
  dimensionDeltas: Record<string, number>
  regressedCases: RegressedCase[]
  missingCases: CaseName[]
  newCases: CaseName[]
  missingDimensions: string[]
}

export interface RunDetail {
  run: Run
  regression: Regression
}

export interface Baseline {
  id: string
  suiteId: string
  suiteName: string
  runId: string
  name: string
  passRate: number
  avgScore: number
  dimensionScores: Record<string, number>
  /** Results saved with it, errors included. */
  caseCount: number
  isCurrent: boolean
  createdAt: string
}

export interface BaselinesList {
  items: Baseline[]
}

export interface BaselineResult {
  caseId: string
  caseName: string
  score: number
  status: ResultStatus
  dimensionScores: Record<string, number>
}

export interface BaselineDetail extends Baseline {
  results: BaselineResult[]
}

export interface RegressionSummary {
  runId: string
  suiteId: string
  suiteName: string
  createdAt: string
  baseline: BaselineRef
  worstDelta: number
}

export interface Overview {
  suiteCount: number
  caseCount: number
  runCount: number
  /** The ten newest runs. */
  recentRuns: Run[]
  /** Every running run. */
  activeRuns: Run[]
  /** Regressed runs among the twenty newest completed ones, against each suite's current baseline. */
  recentRegressions: RegressionSummary[]
  targetsRegistered: boolean
}

// Trend, comparison and red team (plan 4c).

/** One completed run on a suite's trend. */
export interface TrendPoint {
  runId: string
  createdAt: string
  passRate: number
  avgScore: number
  dimensionScores: Record<string, number>
  totalCost: number
  settings: RunSettings
}

/** runs.trend: completed runs oldest first, and the suite's current baseline when it has one. */
export interface Trend {
  points: TrendPoint[]
  baseline?: BaselineRef
}

/** One aggregate metric in each run and B minus A. */
export interface MetricDelta {
  /** pass_rate, avg_score, avg_latency_ms or total_cost. */
  metric: string
  a: number
  b: number
  delta: number
}

/** One case's result in each run; either side may be missing. */
export interface CasePair {
  caseId: string
  caseName: string
  a?: ResultRow
  b?: ResultRow
}

/** runs.compare. Both runs are of one suite; the server refuses any other pair. */
export interface Comparison {
  a: Run
  b: Run
  deltas: MetricDelta[]
  /** Dimensions both runs measured, B minus A. */
  dimensionDeltas: Record<string, number>
  dimensionsOnlyIn: { a: string[]; b: string[] }
  /** A's results in A's order, then cases only B scored. */
  cases: CasePair[]
}

/** One attack type in a run. A bypass is a red-team result that failed; unscored ones errored. */
export interface RedTeamTally {
  attackType: string
  total: number
  bypassed: number
  unscored: number
}

/** redteam.report. The server answers null when the suite has no red-team case at all. */
export interface RedTeamReport {
  /** The scorers that judged these results, sorted. */
  judgedBy: string[]
  byType: RedTeamTally[]
  total: number
  bypassed: number
  unscored: number
}

/** redteam.generate's answer. */
export interface GenerateResult {
  created: number
  /** The most cases one attack type can produce. */
  cap: number
}
