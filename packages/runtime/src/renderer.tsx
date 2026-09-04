import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react"
import type { ReactNode } from "react"
import { IntentErrorBoundary, UnknownIntent } from "./fallbacks"
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
    <RegistryContext.Provider value={registry}>
      {children}
    </RegistryContext.Provider>
  )
}

export function useRegistry(): IntentRegistry {
  const reg = useContext(RegistryContext)

  const subscribe = useCallback(
    (onChange: () => void) => (reg ? reg.subscribe(onChange) : () => {}),
    [reg]
  )
  const getSnapshot = useCallback(() => (reg ? reg.getVersion() : 0), [reg])

  // Re-render this subtree when an intent is registered after mount. Without
  // this, a contributor module that loads late would never appear: the
  // registry is mutable and its identity never changes, so React cannot see it.
  //
  // The hooks run before the throw below, unconditionally, because a hook that
  // only sometimes runs breaks the rules of hooks. The third argument is the
  // server snapshot, required for SSR; the same getter is correct here because
  // a version counter is not browser-specific.
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  if (!reg) {
    throw new Error(
      "useRegistry was called outside a RegistryProvider. " +
        "Wrap the dashboard in <RegistryProvider registry={...}>."
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

  // One boundary per node, keyed on the intent so swapping the intent gives
  // the replacement a clean boundary rather than inheriting a failed one.
  return (
    <IntentErrorBoundary key={node.intent} intent={node.intent}>
      {/* Resolving the component at render time is the whole mechanism this
          package exists for: the server names an intent and the registry
          answers with a component. The rule reads that as a component
          defined inline, which it is not. */}
      {/* eslint-disable-next-line react-hooks/static-components */}
      <Component
        node={node}
        props={node.props ?? {}}
        slots={node.slots ?? {}}
      />
    </IntentErrorBoundary>
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
