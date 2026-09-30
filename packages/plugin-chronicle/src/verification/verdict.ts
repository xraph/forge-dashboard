import type { CoverageSpan, VerifyReport, VerifyResponse } from "../types"
import { formatSeq } from "../format"
import { breaksOf } from "./breaks"

export interface VerdictPart {
  text: string
  mono?: boolean
}

export type VerdictTone = "failed" | "pass" | "nothing-checked" | "no-chain"

/**
 * What the chain page says about one verification.
 *
 * The verdict is a sentence, not a badge: a qualified truth does not compress
 * into a tick. `headline` is the page's one bold element, with the sequence
 * numbers in mono parts so they read as a finding. `qualifiers` follow it in
 * order and are part of the verdict, not footnotes. `limits` is what the
 * method could not see; `limitsLoud` says the limits must be the loudest
 * thing on screen, which is the case for any pass that rests on an unkeyed
 * digest.
 */
export interface Verdict {
  tone: VerdictTone
  headline: VerdictPart[]
  qualifiers: string[]
  limits: string[]
  limitsLoud: boolean
}

const t = (text: string): VerdictPart => ({ text })
const seq = (n: number): VerdictPart => ({ text: formatSeq(n), mono: true })

function rangeParts(prefix: string, from: number, to: number, suffix: string): VerdictPart[] {
  return [t(`${prefix} sequences `), seq(from), t(" to "), seq(to), t(suffix)]
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** What the page knows about the deployment that the report itself cannot say. */
export interface VerdictContext {
  /**
   * Whether the deployment stores checkpoints at all. `checkpointsChecked` on
   * a report cannot answer that: the verifier leaves it false for an empty
   * range even when checkpoints exist. Undefined means the page does not know,
   * and the verdict then says nothing about checkpoint storage.
   */
  checkpointingConfigured?: boolean
}

/**
 * Adjacent spans of one kind merged into ranges, in sequence order. Coverage
 * is not guaranteed to be monotonic: a chain pinned to plain digests but
 * covered by signed checkpoints comes back with unkeyed spans on both sides of
 * a signed one, so the verdict works from ranges and never from a boundary.
 */
function ranges(spans: CoverageSpan[], pick: (s: CoverageSpan) => boolean): [number, number][] {
  const out: [number, number][] = []
  for (const s of [...spans].sort((x, y) => x.fromSeq - y.fromSeq)) {
    if (!pick(s)) continue
    const last = out[out.length - 1]
    if (last && s.fromSeq === last[1] + 1) last[1] = Math.max(last[1], s.toSeq)
    else out.push([s.fromSeq, s.toSeq])
  }
  return out
}

const isUnkeyed = (s: CoverageSpan) => s.level === "unkeyed"
const isDetecting = (s: CoverageSpan) => s.level !== "unkeyed"

/** "1 to 1,500", "1 to 1,500 and 2,000 to 3,000", as verdict parts. */
function rangeListParts(list: [number, number][]): VerdictPart[] {
  const out: VerdictPart[] = []
  list.forEach(([from, to], i) => {
    if (i > 0) out.push(t(i === list.length - 1 ? " and " : ", "))
    out.push(seq(from))
    if (to !== from) out.push(t(" to "), seq(to))
  })
  return out
}

function limitsOf(r: VerifyReport, spans: CoverageSpan[], ctx: VerdictContext): string[] {
  const out: string[] = []
  for (const [from, to] of ranges(spans, isUnkeyed)) {
    out.push(
      `Sequences ${formatSeq(from)} to ${formatSeq(to)} rest on unkeyed digests. Anyone who can write the database can recompute them, so a deliberate rewrite of those events would not be detected.`,
    )
  }
  if (ctx.checkpointingConfigured === false) {
    out.push("This deployment stores no checkpoints, so events removed from the end of the chain cannot be detected.")
  }
  if (r.partial && r.verified > 0) {
    out.push(
      `Only sequences ${formatSeq(r.firstEvent)} to ${formatSeq(r.lastEvent)} were examined. The chain's head is at sequence ${formatSeq(r.headSeq)}.`,
    )
  }
  if (!spans.some((s) => s.level === "anchored")) {
    out.push("Nothing anchors this chain outside the deployment, so someone who controls both the database and the signing key could rewrite it consistently.")
  }
  return out
}

/** One sentence per unkeyed range in a mixed chain. */
function unkeyedQualifiers(spans: CoverageSpan[]): string[] {
  const unkeyed = ranges(spans, isUnkeyed)
  const detecting = spans.filter(isDetecting)
  // "Predate the key" is only true when every unkeyed range comes before all
  // detection and a keyed span exists. A signed span alone can sit over a
  // plain digest, where there is no key to predate.
  const firstDetecting = Math.min(...detecting.map((s) => s.fromSeq))
  const predates =
    detecting.some((s) => s.level === "keyed") && unkeyed.every(([, to]) => to < firstDetecting)
  const tail = "no corruption was detected there, and a deliberate rewrite of them would not show."
  return unkeyed.map(([from, to]) =>
    predates
      ? `Sequences ${formatSeq(from)} to ${formatSeq(to)} predate the key and rest on an unkeyed digest: ${tail}`
      : `Sequences ${formatSeq(from)} to ${formatSeq(to)} rest on an unkeyed digest: ${tail}`,
  )
}

function retainedQualifiers(r: VerifyReport): string[] {
  return (r.retained ?? []).map((rg) => {
    const what =
      rg.fromSeq === rg.toSeq
        ? `Sequence ${formatSeq(rg.fromSeq)} was`
        : `Sequences ${formatSeq(rg.fromSeq)} to ${formatSeq(rg.toSeq)} were`
    const backfill = rg.backfill ? ` The record was recovered afterwards from the archive ${rg.backfill}.` : ""
    return `${what} removed by a retention policy, recorded in the chain at sequence ${formatSeq(rg.recordSeq)}. The chain links across them; what they said is gone.${backfill}`
  })
}

function retentionQualifier(r: VerifyReport): string | null {
  if ((r.gaps ?? []).length === 0) return null
  if (r.retentionPolicies < 0) {
    return "Whether a retention policy removed any of these sequences is unknown: the policy count could not be read."
  }
  if (r.retentionPolicies === 0) return null
  return `${plural(r.retentionPolicies, "retention policy", "retention policies")} can purge this chain. A missing sequence may be a purge that was never recorded in the chain, which Chronicle cannot tell from a deletion.`
}

function tolerantQualifier(r: VerifyReport): string | null {
  const n = (r.tolerant ?? []).length
  if (n === 0) return null
  return `${plural(n, "event", "events")} recorded no digest scheme, so their scheme was inferred when they were checked.`
}

export function verdictOf(response: VerifyResponse, ctx: VerdictContext = {}): Verdict {
  const r = response.report
  if (response.noChain || !r) {
    return {
      tone: "no-chain",
      headline: [t("This scope has not recorded any events, so there is no chain to verify.")],
      qualifiers: [],
      limits: [],
      limitsLoud: false,
    }
  }

  const spans = r.coverage ?? []
  const limits = limitsOf(r, spans, ctx)
  const partial = r.partial ? ["This check does not speak for the rest of the chain."] : []

  if (!r.valid) {
    const breaks = breaksOf(r)
    const count = (k: string) => breaks.filter((b) => b.kind === k).reduce((n, b) => n + (b.toSeq - b.fromSeq + 1), 0)
    const kinds: string[] = []
    if (count("missing")) kinds.push(`${count("missing")} missing`)
    if (count("altered")) kinds.push(`${count("altered")} altered`)
    if (count("relabelled")) kinds.push(`${count("relabelled")} relabelled`)
    const head: string[] = []
    if (breaks.some((b) => b.kind === "truncated")) head.push("the head does not match the last event")
    if (breaks.some((b) => b.kind === "head-contradicted")) head.push("a signed checkpoint says the chain once reached further")
    const summary = [kinds.join(", "), head.join(", and ")].filter(Boolean).join("; ")
    const said = summary || "a checkpoint check failed"
    // With nothing examined there is no range to name, and inventing one
    // ("1 to 0") would be a claim about events nobody looked at.
    const examined = r.verified > 0
    return {
      tone: "failed",
      headline: examined
        ? rangeParts("Breaks found in", r.firstEvent || 1, r.lastEvent || r.headSeq, `: ${said}.`)
        : [t(`Breaks found: ${said}.`)],
      qualifiers: [...(examined ? [] : ["No events were examined in the requested range."]), ...partial, ...[retentionQualifier(r)].filter((q): q is string => q !== null), ...retainedQualifiers(r)],
      limits,
      limitsLoud: false,
    }
  }

  if (r.verified === 0) {
    const retained = retainedQualifiers(r)
    const why =
      retained.length > 0
        ? "Retention records account for this range: its events were removed by a retention policy."
        : ctx.checkpointingConfigured === false
          ? "Without signed checkpoints a chain wiped to its start looks exactly like this."
          : "The requested range holds no events."
    return {
      tone: "nothing-checked",
      headline: [t("No events verified.")],
      qualifiers: [`An empty range verifies trivially, and that is not a pass. ${why}`, ...retained],
      limits,
      limitsLoud: false,
    }
  }

  const allUnkeyed = spans.length === 0 || spans.every(isUnkeyed)
  const mixed = !allUnkeyed && spans.some(isUnkeyed)
  const qualifiers: string[] = [...partial]
  let headline: VerdictPart[]
  if (allUnkeyed) {
    headline = rangeParts("No corruption detected in", r.firstEvent, r.lastEvent, ".")
    qualifiers.unshift("This chain uses unkeyed digests: they detect accidental corruption, not deliberate alteration.")
  } else if (mixed) {
    // The headline claims only what a detecting digest covers. The unkeyed
    // ranges get their own sentence, so the claim never reaches past its method.
    headline = [t("No alteration detected in sequences "), ...rangeListParts(ranges(spans, isDetecting)), t(".")]
    qualifiers.push(...unkeyedQualifiers(spans))
  } else {
    headline = rangeParts("No alteration detected in", r.firstEvent, r.lastEvent, ".")
  }
  const tolerant = tolerantQualifier(r)
  if (tolerant) qualifiers.push(tolerant)
  qualifiers.push(...retainedQualifiers(r))

  return { tone: "pass", headline, qualifiers, limits, limitsLoud: allUnkeyed || mixed }
}

/** The verdict as one string: the page's accessible description, and what tests read. */
export function verdictText(v: Verdict): string {
  return [v.headline.map((p) => p.text).join(""), ...v.qualifiers, ...v.limits].join(" ")
}
