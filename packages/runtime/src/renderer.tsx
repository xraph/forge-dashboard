import { createContext, useContext } from "react"
import type { ReactNode } from "react"
import { UnknownIntent } from "./fallbacks"
import type { IntentRegistry } from "./registry"
import type { GraphNode } from "./types"

const RegistryContext = createContext<IntentRegistry | null>(null)

export function RegistryProvider({
  registry,
  children,
}: {
  registry: IntentRegistry
  children: ReactNode
}) {
  return (
    <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
  )
}

export function useRegistry(): IntentRegistry {
  const reg = useContext(RegistryContext)
  if (!reg) {
    throw new Error(
      "useRegistry was called outside a RegistryProvider. " +
        "Wrap the dashboard in <RegistryProvider registry={...}>.",
    )
  }
  return reg
}

/** Renders one graph node by resolving its intent through the registry. */
export function GraphRenderer({ node }: { node: GraphNode }) {
  const registry = useRegistry()
  const Component = registry.resolve(node.intent)

  if (!Component) {
    return <UnknownIntent intent={node.intent} />
  }

  return (
    <Component
      node={node}
      props={node.props ?? {}}
      slots={node.slots ?? {}}
    />
  )
}

/**
 * Renders the children a parent invited into a named slot. The renderer never
 * decides placement; the parent does, by calling this somewhere in its JSX.
 */
export function SlotRenderer({
  slot,
  slots,
}: {
  slot: string
  slots: Record<string, GraphNode[]>
}) {
  const children = slots[slot]
  if (!children?.length) return null

  return (
    <>
      {children.map((child, i) => (
        <GraphRenderer key={`${child.intent}:${i}`} node={child} />
      ))}
    </>
  )
}
