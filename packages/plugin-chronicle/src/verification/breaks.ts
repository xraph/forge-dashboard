import type { VerifyReport } from "../types"
import { formatSeq } from "../format"

/**
 * The five ways a chain can be broken, in plain language. A break has a
 * location and a kind; that is what an operator working through a failure
 * needs, and what a boolean cannot give them.
 */
export type BreakKind = "altered" | "missing" | "relabelled" | "truncated" | "head-contradicted"

export interface Break {
  kind: BreakKind
  fromSeq: number
  toSeq: number
  title: string
  explanation: string
}

/** Consecutive sequences as [from, to] runs. */
export function runs(seqs: number[]): [number, number][] {
  const sorted = [...seqs].sort((a, b) => a - b)
  const out: [number, number][] = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s === last[1] + 1) last[1] = s
    else out.push([s, s])
  }
  return out
}

function span(from: number, to: number): string {
  return from === to ? `Sequence ${formatSeq(from)}` : `Sequences ${formatSeq(from)} to ${formatSeq(to)}`
}

/**
 * Break rows for a report, in sequence order, head-level breaks last. A
 * retained range is not a break: a retention record in the chain vouches for
 * it, and it is listed separately.
 */
export function breaksOf(r: VerifyReport): Break[] {
  const out: Break[] = []
  for (const [from, to] of runs(r.gaps ?? [])) {
    out.push({
      kind: "missing",
      fromSeq: from,
      toSeq: to,
      title: `${span(from, to)} missing`,
      explanation:
        "These sequences are absent from the store and no retention record accounts for them, so events were removed from the middle of the chain.",
    })
  }
  for (const s of r.tampered ?? []) {
    out.push({
      kind: "altered",
      fromSeq: s,
      toSeq: s,
      title: `Sequence ${formatSeq(s)} altered`,
      explanation:
        "Its recomputed digest differs from the one stored, or it does not link to the event before it: its content or its position was changed after it was written.",
    })
  }
  for (const s of r.downgrades ?? []) {
    out.push({
      kind: "relabelled",
      fromSeq: s,
      toSeq: s,
      title: `Sequence ${formatSeq(s)} relabelled`,
      explanation:
        "It claims a weaker digest scheme than the chain required at that point, which is how an attacker would dodge a keyed digest. Treat it as tampering, and find out who has write access to the events table.",
    })
  }
  out.sort((a, b) => a.fromSeq - b.fromSeq)
  if (r.headChecked && !r.headMatch) {
    out.push({
      kind: "truncated",
      fromSeq: r.headSeq,
      toSeq: r.headSeq,
      title: `Head at sequence ${formatSeq(r.headSeq)} does not match`,
      explanation:
        "The chain's recorded head does not match its last event, so events after it may have been removed. No link inside the chain can show this, so find out who holds write access to the events and streams tables.",
    })
  }
  if (r.checkpointHeadChecked && !r.checkpointHeadOk) {
    out.push({
      kind: "head-contradicted",
      fromSeq: r.headSeq,
      toSeq: r.headSeq,
      title: "A signed checkpoint contradicts the head",
      explanation: `A signed checkpoint says the chain once reached past sequence ${formatSeq(r.headSeq)}. Events the chain no longer claims were there when it was signed. Nothing inside the surviving range has to look wrong for that, so find out who holds write access to the events and streams tables.`,
    })
  }
  return out
}

export function breakAnchor(b: Break): string {
  return `break-${b.kind}-${b.fromSeq}`
}
