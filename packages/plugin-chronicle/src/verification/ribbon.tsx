import { useEffect, useState } from "react"
import type { VerifyReport } from "../types"
import { formatSeq } from "../format"
import { breakAnchor, breaksOf } from "./breaks"

/**
 * The span ribbon: a hash chain drawn as what it is, a line.
 *
 * Coverage bands are the base layer, checkpoints are notches, retained ranges
 * are hatched, and breaks are markers at their exact positions. Each marker is
 * a real button that moves focus to its row in the break table, which is how
 * somebody working through a failure gets from "where" to "what" without
 * losing their place. A chain is linear, one edge per node, so this is a
 * positional ribbon and not a graph canvas.
 *
 * The only motion on the page: the track draws once when a result arrives,
 * and not at all under reduced motion.
 */
const BAND: Record<string, string> = {
  unkeyed: "bg-muted",
  keyed: "bg-foreground/30",
  signed: "bg-foreground/60",
  anchored: "bg-foreground",
}

export function Ribbon({
  report,
  fromSeq,
  toSeq,
}: {
  report: VerifyReport
  fromSeq: number
  toSeq: number
}) {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const width = Math.max(1, toSeq - fromSeq + 1)
  const pct = (seq: number) =>
    `${(((seq - fromSeq) / width) * 100).toFixed(2)}%`
  const pctWidth = (from: number, to: number) =>
    `${(((to - from + 1) / width) * 100).toFixed(2)}%`
  const breaks = breaksOf(report).filter(
    (b) => b.kind !== "truncated" && b.kind !== "head-contradicted"
  )

  const focusRow = (anchor: string) => {
    const el = document.getElementById(anchor)
    el?.scrollIntoView?.({ block: "center" })
    el?.focus()
  }

  return (
    <div
      className="relative h-10 w-full"
      aria-label={`Chain from sequence ${formatSeq(fromSeq)} to ${formatSeq(toSeq)}`}
      role="group"
    >
      <div
        data-testid="ribbon-track"
        className="absolute inset-x-0 top-3 h-4 origin-left overflow-hidden rounded-sm border motion-safe:transition-transform motion-safe:duration-700 motion-reduce:transition-none"
        style={{ transform: drawn ? "scaleX(1)" : "scaleX(0)" }}
      >
        {(report.coverage ?? []).map((s) => (
          <div
            key={`${s.fromSeq}-${s.level}`}
            data-testid="ribbon-band"
            data-level={s.level}
            title={`${s.level}: sequences ${formatSeq(s.fromSeq)} to ${formatSeq(s.toSeq)}`}
            className={`absolute inset-y-0 ${BAND[s.level] ?? "bg-muted"}`}
            style={{
              left: pct(s.fromSeq),
              width: pctWidth(s.fromSeq, s.toSeq),
            }}
          />
        ))}
        {(report.retained ?? []).map((r) => (
          <div
            key={`retained-${r.fromSeq}`}
            data-testid="ribbon-retained"
            title={`Removed by retention: sequences ${formatSeq(r.fromSeq)} to ${formatSeq(r.toSeq)}`}
            className="absolute inset-y-0 bg-background bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,var(--border)_3px,var(--border)_5px)]"
            style={{
              left: pct(r.fromSeq),
              width: pctWidth(r.fromSeq, r.toSeq),
            }}
          />
        ))}
        {(report.checkpoints ?? []).map((c) => (
          <div
            key={c.id}
            aria-hidden
            className="absolute inset-y-0 w-px bg-foreground"
            style={{ left: pct(Math.min(c.toSeq, toSeq)) }}
          />
        ))}
      </div>
      {breaks.map((b) => (
        <button
          key={breakAnchor(b)}
          type="button"
          aria-label={b.title}
          onClick={() => focusRow(breakAnchor(b))}
          className="absolute top-1 h-8 w-2 -translate-x-1/2 rounded-sm bg-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          style={{ left: pct(b.fromSeq) }}
        />
      ))}
    </div>
  )
}
