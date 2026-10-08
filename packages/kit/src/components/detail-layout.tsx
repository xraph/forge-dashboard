import type { ReactNode } from "react"
import { cn } from "@forge-go/dashboard-kit/lib/utils"

export interface DescriptionItem {
  term: string
  /** A node, not a string, so a value can be a Badge or a copy button. */
  value: ReactNode
}

export interface DescriptionListProps {
  items: DescriptionItem[]
  className?: string
}

/**
 * The field list every detail pane opens with.
 *
 * A real `<dl>` with `<dt>`/`<dd>` pairs and not a two-column grid of divs.
 * The pairing is the content, and a screen reader announces it only when the
 * elements say so.
 */
export function DescriptionList({ items, className }: DescriptionListProps) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm",
        className
      )}
    >
      {items.map((item) => (
        <div key={item.term} className="contents">
          <dt className="text-muted-foreground">{item.term}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export interface DetailLayoutProps {
  main: ReactNode
  /** Secondary panes: related sessions, devices, sub-plugin sections. */
  aside?: ReactNode
  className?: string
}

/**
 * Two columns on a wide screen, stacked on a narrow one.
 *
 * The aside is a `<aside>` so it lands in the accessibility tree as a
 * complementary landmark, which is what lets somebody skip past a user's
 * device list to get back to the user.
 */
export function DetailLayout({ main, aside, className }: DetailLayoutProps) {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-1 gap-6 @3xl/main:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-6">{main}</div>
      {aside && <aside className="flex min-w-0 flex-col gap-6">{aside}</aside>}
    </div>
  )
}
