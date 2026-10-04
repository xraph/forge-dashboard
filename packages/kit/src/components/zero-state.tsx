import type { ReactNode } from "react"
import { Inbox } from "lucide-react"
import { cn } from "@forge-go/dashboard-kit/lib/utils"

export interface ZeroStateProps {
  title: string
  body?: string
  illustration?: ReactNode
  action?: ReactNode
  className?: string
}

/** A compact, illustrated empty result with its next action in the same place. */
export function ZeroState({ title, body, illustration, action, className }: ZeroStateProps) {
  return (
    <section role="status" className={cn("flex min-w-0 flex-col items-start gap-2 rounded-md border bg-card p-5 text-left", className)}>
      <div aria-hidden="true" className="flex size-12 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground">
        {illustration ?? <Inbox className="size-6 stroke-[1.5]" />}
      </div>
      <h3 className="mt-1 text-sm font-medium text-foreground">{title}</h3>
      {body && <p className="max-w-prose text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-1 flex flex-wrap gap-2">{action}</div>}
    </section>
  )
}
