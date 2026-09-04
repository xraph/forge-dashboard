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
  // A fetch descriptor: the intent of a data operation and its params. It
  // mirrors the Go contract and is part of the wire shape, but nothing
  // consumes it yet - there is no fetch layer in W1. W2 adds one, and only
  // then does this reach an intent component.
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

// No `data` here, deliberately. GraphNode.data is a fetch descriptor and
// nothing fetches it yet, so a `data` prop on this interface would promise
// every intent component something the renderer has never once supplied.
export interface IntentComponentProps<TProps = Record<string, unknown>> {
  node: GraphNode
  props: TProps
  slots: Record<string, GraphNode[]>
}

export type IntentComponent = ComponentType<
  IntentComponentProps<Record<string, unknown>>
>
