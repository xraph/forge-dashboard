import type { ReactNode } from "react"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@forge-go/dashboard-kit/components/empty"

export interface EmptyStateProps {
  /** What is missing, as a sentence. "No users yet." */
  title: string
  /** Optional second line telling the reader what to do about it. */
  description?: string
  icon?: ReactNode
  /** Usually the button that creates the first one. */
  action?: ReactNode
  className?: string
}

/**
 * What a list renders when a read succeeded and returned nothing.
 *
 * `role="status"` and not a bare div: an empty result is information, and a
 * screen reader that hears silence cannot tell it apart from a list that is
 * still loading.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <Empty role="status" className={cn("border", className)}>
      <EmptyHeader>
        {icon && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}
