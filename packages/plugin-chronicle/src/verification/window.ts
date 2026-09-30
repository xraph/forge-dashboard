import { LIMITS } from "../types"

export interface SeqRange {
  fromSeq: number
  toSeq: number
}

/**
 * The window a verification runs over unless the operator asks for more.
 *
 * Verification holds every event in its range in memory, and the server
 * refuses a span over 100,000. A recent bounded window is the default, and it
 * sets `partial`, which the verdict says out loud. Bounded verification with
 * intact signed checkpoints is a stronger claim than an unbounded walk over an
 * unkeyed chain.
 */
export const DEFAULT_WINDOW = 10_000

export function defaultWindow(headSeq: number): SeqRange | null {
  if (headSeq <= 0) return null
  return { fromSeq: Math.max(1, headSeq - DEFAULT_WINDOW + 1), toSeq: headSeq }
}

/**
 * 0 to 0 is how the server is asked for genesis to head without naming either
 * end. It is the only way to check a chain whose head is zero, and that chain
 * still has to be checked: a wipe to zero is exactly the case where a surviving
 * signed checkpoint that contradicts the head is the evidence.
 */
export const GENESIS_TO_HEAD: SeqRange = { fromSeq: 0, toSeq: 0 }

export function wholeChain(headSeq: number): SeqRange {
  if (headSeq <= 0) return GENESIS_TO_HEAD
  return { fromSeq: 1, toSeq: headSeq }
}

/** A verify.run input. Genesis to head goes as the chain alone, with no range. */
export function verifyInput(streamId: string, r: SeqRange): Record<string, unknown> {
  if (r.fromSeq === GENESIS_TO_HEAD.fromSeq && r.toSeq === GENESIS_TO_HEAD.toSeq) return { streamId }
  return { streamId, fromSeq: r.fromSeq, toSeq: r.toSeq }
}

export function exceedsCap(r: SeqRange): boolean {
  return r.toSeq - r.fromSeq + 1 > LIMITS.verifySpan
}

/** A window around one event, for the "check the chain around this event" link. */
export function aroundSeq(seq: number, headSeq: number, radius = 50): SeqRange {
  return { fromSeq: Math.max(1, seq - radius), toSeq: Math.min(headSeq, seq + radius) }
}

/** Route params are strings; a range the page cannot trust is no range. */
export function parseRangeParams(from?: string, to?: string): SeqRange | null {
  if (from === undefined || to === undefined) return null
  if (!/^\d+$/.test(from) || !/^\d+$/.test(to)) return null
  const r = { fromSeq: Number(from), toSeq: Number(to) }
  if (r.fromSeq < 1 || r.toSeq < r.fromSeq) return null
  return r
}

/**
 * A range held to the chain's head. The verifier reports a head mismatch on an
 * intact chain when asked for a `toSeq` past the head, so no request goes out
 * with one. A range that starts past the head has nothing to check.
 */
export function clampToHead(r: SeqRange, headSeq: number): SeqRange | null {
  if (r.fromSeq > headSeq) return null
  return { fromSeq: r.fromSeq, toSeq: Math.min(r.toSeq, headSeq) }
}
