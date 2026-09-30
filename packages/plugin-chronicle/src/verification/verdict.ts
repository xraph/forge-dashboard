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

/** The first sequence at or above which the chain is keyed, if it is mixed. */
function keyedBoundary(spans: CoverageSpan[]): number | null {
  const hasUnkeyed = spans.some((s) => s.level === "unkeyed")
  const firstAbove = spans.find((s) => s.level !== "unkeyed")
  return hasUnkeyed && firstAbove ? firstAbove.fromSeq : null
}

function limitsOf(r: VerifyReport, spans: CoverageSpan[]): string[] {
  const out: string[] = []
  const unkeyed = spans.filter((s) => s.level === "unkeyed")
  if (unkeyed.length > 0) {
    const from = unkeyed[0].fromSeq
    const to = unkeyed[unkeyed.length - 1].toSeq
    out.push(
      `Sequences ${formatSeq(from)} to ${formatSeq(to)} rest on unkeyed digests. Anyone who can write the database can recompute them, so a deliberate rewrite of those events would not be detected.`,
    )
  }
  if (!r.checkpointsChecked) {
    out.push("This deployment stores no checkpoints, so events removed from the end of the chain cannot be detected.")
  }
  if (r.partial) {
    out.push(
      `Only sequences ${formatSeq(r.firstEvent)} to ${formatSeq(r.lastEvent)} were examined. The chain's head is at sequence ${formatSeq(r.headSeq)}.`,
    )
  }
  if (!spans.some((s) => s.level === "anchored")) {
    out.push("Nothing anchors this chain outside the deployment, so someone who controls both the database and the signing key could rewrite it consistently.")
  }
  return out
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

export function verdictOf(response: VerifyResponse): Verdict {
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
  const limits = limitsOf(r, spans)
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
    const from = r.firstEvent || 1
    const to = r.lastEvent || r.headSeq
    return {
      tone: "failed",
      headline: rangeParts("Breaks found in", from, to, `: ${summary || "a checkpoint check failed"}.`),
      qualifiers: [...partial, ...[retentionQualifier(r)].filter((q): q is string => q !== null), ...retainedQualifiers(r)],
      limits,
      limitsLoud: false,
    }
  }

  if (r.verified === 0) {
    const wiped = r.checkpointsChecked
      ? "The chain has no events in this range."
      : "Without signed checkpoints a chain wiped to its start looks exactly like this."
    return {
      tone: "nothing-checked",
      headline: [t("No events verified.")],
      qualifiers: [`An empty range verifies trivially, and that is not a pass. ${wiped}`],
      limits,
      limitsLoud: false,
    }
  }

  const allUnkeyed = spans.length === 0 || spans.every((s) => s.level === "unkeyed")
  const boundary = keyedBoundary(spans)
  const qualifiers: string[] = [...partial]
  let headline: VerdictPart[]
  if (allUnkeyed) {
    headline = rangeParts("No corruption detected in", r.firstEvent, r.lastEvent, ".")
    qualifiers.unshift("This chain uses unkeyed digests: they detect accidental corruption, not deliberate alteration.")
  } else if (boundary !== null) {
    headline = [
      ...rangeParts("No alteration detected in", r.firstEvent, r.lastEvent, ". "),
      t("Keyed from "),
      seq(boundary),
      t(" onward, and everything below that predates the key and rests on an unkeyed digest."),
    ]
  } else {
    headline = rangeParts("No alteration detected in", r.firstEvent, r.lastEvent, ".")
  }
  const tolerant = tolerantQualifier(r)
  if (tolerant) qualifiers.push(tolerant)
  qualifiers.push(...retainedQualifiers(r))

  return { tone: "pass", headline, qualifiers, limits, limitsLoud: allUnkeyed || boundary !== null }
}

/** The verdict as one string: the page's accessible description, and what tests read. */
export function verdictText(v: Verdict): string {
  return [v.headline.map((p) => p.text).join(""), ...v.qualifiers, ...v.limits].join(" ")
}
