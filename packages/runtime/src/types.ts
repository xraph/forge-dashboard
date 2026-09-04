import type { ComponentType } from "react"

/** Mirrors NavConfig in contract/manifest.go. */
export interface NavConfig {
  group?: string
  icon?: string
  priority?: number
  badge?: string
}

/** Mirrors Predicate in contract/manifest.go. */
export interface Predicate {
  all?: string[]
  any?: string[]
  not?: string[]
  warden?: string
}

// Deliberately omits `src` and `sandbox`. Those exist on the Go GraphNode but
// were never implemented on the React side, and the design spec removes them.
// Re-adding them here would recreate a declared-but-unimplemented API, which is
// the exact failure this rewrite exists to correct.
/** A node in the server-sent UI graph. Mirrors GraphNode in contract/manifest.go. */
export interface GraphNode {
  intent: string
  title?: string
  route?: string
  nav?: NavConfig
  root?: boolean
  data?: { intent: string; params?: Record<string, unknown> }
  props?: Record<string, unknown>
  slots?: Record<string, GraphNode[]>
  visibleWhen?: Predicate
  enabledWhen?: Predicate
  op?: string
  payload?: Record<string, unknown>
  component?: string
  protocol?: string
}

export interface IntentComponentProps<
  TData = unknown,
  TProps = Record<string, unknown>,
> {
  node: GraphNode
  data?: TData
  props: TProps
  slots: Record<string, GraphNode[]>
}

export type IntentComponent = ComponentType<
  IntentComponentProps<unknown, Record<string, unknown>>
>
