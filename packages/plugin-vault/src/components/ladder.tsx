import type { ReactNode } from "react"
import { cn } from "@forge-go/dashboard-kit/lib/utils"

/*
 * The evaluation ladder, as layout and nothing else.
 *
 * A flag is a ladder: the engine walks its rungs top to bottom and the first
 * one that has an answer decides. So the page draws it as one, numbered in the
 * engine's own order and joined by a vertical rail. These components know
 * nothing about flags. They take the words and the values and lay them out, so
 * the page decides what a rung says and the evaluation and rule editing work
 * can hang more on the same shape without touching it.
 *
 * Where later work attaches, per rung and per row:
 *   `mark`        a badge beside the title or summary ("Decided here").
 *   `annotation`  one muted line under it ("t-acme lands in bucket 12").
 *   `actions`     buttons.
 *   `decided`     the rail turns primary, and `data-decided` says so.
 *   `muted`       the rung's body dims. The `notice` stays at full strength
 *                 above it, because the sentence, not the opacity, is what
 *                 tells an operator why.
 */

/** The rail. Children are `Rung`s, in the order the engine walks them. */
export function Ladder({ children }: { children: ReactNode }) {
  // role="list" because list-style none strips the semantics in some
  // browsers, and the order of these is the point.
  return (
    <ol role="list" className="flex flex-col">
      {children}
    </ol>
  )
}

export interface RungProps {
  /** Stable name for the rung, on `data-rung`. */
  id: string
  /** The rung's position, 1 upwards. */
  number: number
  title: string
  /** One sentence saying what this rung does to evaluation. */
  note?: ReactNode
  /** Beside the title. */
  mark?: ReactNode
  /** Under the header. */
  annotation?: ReactNode
  /** The rung's buttons, at the right of the header. */
  actions?: ReactNode
  /** A sentence above the rung, not dimmed with it. */
  notice?: ReactNode
  /** Dims the body. */
  muted?: boolean
  /** The rung that decided an evaluation. */
  decided?: boolean
  children?: ReactNode
}

export function Rung({
  id,
  number,
  title,
  note,
  mark,
  annotation,
  actions,
  notice,
  muted,
  decided,
  children,
}: RungProps) {
  return (
    <li
      data-rung={id}
      data-decided={decided ? "true" : undefined}
      className={cn(
        "ml-3 flex flex-col gap-2 border-l pb-6 pl-6 last:pb-0",
        decided ? "border-l-2 border-primary" : "last:border-l-transparent",
      )}
    >
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      <div
        data-slot="rung-body"
        className={cn("relative flex flex-col gap-2", muted && "opacity-60")}
      >
        <span
          aria-hidden="true"
          className="absolute -left-[37px] top-0 flex size-6 items-center justify-center rounded-full border bg-background font-mono text-xs font-medium tabular-nums"
        >
          {number}
        </span>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 className="text-sm font-medium">{title}</h2>
            {mark}
            {note ? (
              <span className="text-sm text-muted-foreground">{note}</span>
            ) : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
        {annotation ? (
          <div className="text-sm text-muted-foreground">{annotation}</div>
        ) : null}
        {children}
      </div>
    </li>
  )
}

/** The rows inside a rung: overrides, or rules. */
export function LadderRows({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <ul role="list" aria-label={label} className="flex flex-col gap-1">
      {children}
    </ul>
  )
}

export interface LadderRowProps {
  /** The rule's number, when the rows are numbered. Overrides have none. */
  lead?: ReactNode
  /** The row's words. */
  children: ReactNode
  /** The answer this row gives, in the right-hand column. */
  value?: ReactNode
  mark?: ReactNode
  annotation?: ReactNode
  actions?: ReactNode
  decided?: boolean
  /** Dims the row: the engine never got as far as it. */
  muted?: boolean
}

/**
 * One row. The values sit in their own right-aligned column so the eye can
 * run down "what it returns". On a narrow screen the value drops under the
 * words.
 */
export function LadderRow({
  lead,
  children,
  value,
  mark,
  annotation,
  actions,
  decided,
  muted,
}: LadderRowProps) {
  const hasLead = lead !== undefined && lead !== null
  return (
    <li
      data-decided={decided ? "true" : undefined}
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm",
        decided && "border-primary",
        muted && "opacity-60",
      )}
    >
      {hasLead ? (
        <span
          data-slot="row-lead"
          className="w-5 shrink-0 font-mono text-xs font-medium tabular-nums text-muted-foreground"
        >
          {lead}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {children}
          {mark}
        </div>
        {annotation ? (
          <div className="text-xs text-muted-foreground">{annotation}</div>
        ) : null}
      </div>
      {value !== undefined ? (
        <div className="flex min-w-16 items-center justify-end gap-2 text-right">
          {value}
        </div>
      ) : null}
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </li>
  )
}
