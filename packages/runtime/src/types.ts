import type { ComponentType } from "react"

/** A node in the server-sent UI graph. Mirrors GraphNode in contract/manifest.go. */
export interface GraphNode {
  intent: string
  title?: string
  route?: string
  data?: { intent: string; params?: Record<string, unknown> }
  props?: Record<string, unknown>
  slots?: Record<string, GraphNode[]>
  op?: string
  payload?: Record<string, unknown>
  component?: string
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
