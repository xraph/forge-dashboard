import { createContext, useContext } from "react"
import type { ReactNode } from "react"
import { PluginErrorBoundary } from "@forge-go/dashboard-runtime"
import { PluginProvider } from "./context"
import type { ScopedClient } from "./client"
import type { ForgeSubPlugin, SlotContribution, SlotName } from "./types"

/** One ready sub-plugin and the client bound to its own extension. */
export interface ResolvedSubPlugin {
  subPlugin: ForgeSubPlugin
  client: ScopedClient
}

const SubPluginContext = createContext<ResolvedSubPlugin[]>([])

/**
 * Supplies the ready sub-plugins to every slot beneath it.
 *
 * The host builds this list once, after resolving each sub-plugin against
 * capabilities. Only ready ones reach here: hidden, mismatched and
 * setup-pending sub-plugins contribute nothing to anybody else's page, because
 * a widget reading "needs configuring" on somebody else's overview is noise
 * rather than information.
 */
export function SubPluginProvider({
  entries,
  children,
}: {
  entries: ResolvedSubPlugin[]
  children: ReactNode
}) {
  return (
    <SubPluginContext.Provider value={entries}>
      {children}
    </SubPluginContext.Provider>
  )
}

interface Resolved {
  entry: ResolvedSubPlugin
  contribution: SlotContribution
}

/**
 * Every contribution to one slot, ordered.
 *
 * Priority first, then id. The id tiebreak matters: without it the order is
 * whatever the plugin array happened to be in, which changes when somebody
 * reorders an import and produces a diff nobody can explain.
 */
function contributionsFor(entries: ResolvedSubPlugin[], name: SlotName): Resolved[] {
  const out: Resolved[] = []
  for (const entry of entries) {
    for (const contribution of entry.subPlugin.contributions[name] ?? []) {
      out.push({ entry, contribution })
    }
  }
  return out.sort((a, b) => {
    const byPriority =
      (a.contribution.priority ?? 0) - (b.contribution.priority ?? 0)
    if (byPriority !== 0) return byPriority
    return a.contribution.id < b.contribution.id ? -1 : 1
  })
}

export interface PluginSlotProps {
  name: SlotName
  /** Handed to every contribution. `{ userId }`, `{ orgId }`, or nothing. */
  params?: Record<string, unknown>
}

/**
 * Renders every sub-plugin contribution to one named slot.
 *
 * Two things this deliberately does not do. It renders no wrapper element,
 * not even a fragment with a class, so a host page that drops a slot into a
 * layout gets nothing at all when nobody contributes rather than an empty box
 * with padding. And it renders each contribution inside its own error
 * boundary keyed by the contributing extension, so one sub-plugin throwing
 * during render loses its own section and leaves the host page and every
 * sibling contribution alone. These are separately versioned bundles. One of
 * them will throw.
 *
 * Each contribution also gets its own `PluginProvider`, carrying the client
 * bound to its own extension. That is what makes a widget on the auth
 * overview query `organization` rather than `auth`.
 */
export function PluginSlot({ name, params }: PluginSlotProps) {
  const entries = useContext(SubPluginContext)
  const resolved = contributionsFor(entries, name)

  if (resolved.length === 0) return null

  return (
    <>
      {resolved.map(({ entry, contribution }) => {
        const Contribution = contribution.render
        return (
          <PluginErrorBoundary
            key={`${entry.subPlugin.extension}:${contribution.id}`}
            plugin={entry.subPlugin.extension}
          >
            <PluginProvider client={entry.client}>
              <Contribution {...(params ?? {})} />
            </PluginProvider>
          </PluginErrorBoundary>
        )
      })}
    </>
  )
}

/**
 * How many contributions a slot would render.
 *
 * A host page that wants a heading above its slot has to know whether the slot
 * is empty, and `PluginSlot` cannot tell it because it renders nothing at all
 * in that case. Returns 0 outside any provider, so a page renders correctly
 * standalone in a test.
 */
export function useSlotCount(name: SlotName): number {
  return contributionsFor(useContext(SubPluginContext), name).length
}

/**
 * A sub-plugin's declared, narrow access to its host's intents.
 *
 * The rule everywhere else is that a plugin queries its own extension and
 * nothing else, enforced by the contributor name being closed over inside the
 * client rather than passed as an argument. This is the one declared exception,
 * and it exists because eighteen authsome sub-plugins have no intents of their
 * own: their settings panel reads `settings.namespace` from `auth`.
 *
 * `allowed` is what keeps the exception narrow. A settings-only sub-plugin
 * declares four intents and can reach nothing else, so the widening is visible
 * in the sub-plugin's own declaration rather than implied by having a host.
 */
export interface HostAccess {
  client: ScopedClient
  allowed: string[]
  /** Named in the error when a sub-plugin reaches past its allowlist. */
  subExtension: string
}

const HostAccessContext = createContext<HostAccess | null>(null)

export function HostAccessProvider({
  value,
  children,
}: {
  value: HostAccess
  children: ReactNode
}) {
  return (
    <HostAccessContext.Provider value={value}>
      {children}
    </HostAccessContext.Provider>
  )
}

/**
 * Resolves the host client for one intent, or throws.
 *
 * Throws rather than returning an error state, and throws during render rather
 * than on the request. An intent outside the allowlist is a mistake in the
 * sub-plugin's own declaration, not a runtime condition to render around, and
 * it should be as loud as `definePlugin`'s import-time validation. The
 * error boundary around every contribution catches it, so the failure is
 * contained to the sub-plugin that made it.
 */
export function useHostAccess(intent: string): ScopedClient {
  const access = useContext(HostAccessContext)
  if (!access) {
    throw new Error(
      `useHostQuery/useHostCommand were called outside a HostAccessProvider (intent "${intent}"). Only a sub-plugin's own routes and contributions may read host intents.`,
    )
  }
  if (!access.allowed.includes(intent)) {
    throw new Error(
      `sub-plugin "${access.subExtension}" read host intent "${intent}" without declaring it. Add it to \`hostIntents\` in defineSubPlugin, or query the sub-plugin's own extension instead.`,
    )
  }
  return access.client
}
