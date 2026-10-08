import type { ReactNode } from "react"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"

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
    <ZeroState
      title={title}
      body={description}
      illustration={icon}
      action={action}
      className={className}
    />
  )
}
