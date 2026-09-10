import type { ComponentType } from "react"
import { useHostCommand, useHostQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { QueryBoundary, CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { SettingsForm } from "@forge-go/dashboard-kit/components/settings-form"
import { flattenCategories, toDescriptors } from "../settings-fields"
import type { SettingsNamespaceResponse } from "../settings-fields"

/**
 * Every host intent a settings-only sub-plugin may reach, and no others.
 *
 * Four strings is the whole of the exception to "a plugin queries its own
 * extension and nothing else". It is declared per sub-plugin rather than
 * granted by having a host, so the widening is readable at the call site
 * instead of implied.
 */
export const SETTINGS_INTENTS = [
  "settings.namespace",
  "settings.update",
  "settings.enforce",
  "settings.unenforce",
] as const

/**
 * A settings panel bound to one namespace.
 *
 * Call this ONCE per sub-plugin, at module scope, and reuse the returned
 * component for both the route and the settings tab. Calling it inside a
 * render would mint a new component type on every pass and remount the form
 * under the operator's cursor, discarding whatever they had typed.
 *
 * Typed as `ComponentType<PluginPageProps>` rather than the bare `ComponentType`
 * (which defaults to `ComponentType<{}>`): a route's `element` and a slot's
 * contribution both hand this component a required `params` prop, and `tsc`
 * (unlike vitest) checks that the returned component can actually accept one.
 * The panel does not read `params` -- a namespace is fixed at module scope --
 * but it has to declare the prop to be usable where every other page is.
 */
export function settingsPanelFor(namespace: string): ComponentType<PluginPageProps> {
  function SettingsPanel() {
    const query = useHostQuery<SettingsNamespaceResponse>("settings.namespace", {
      namespace,
      scope: "app",
    })
    const update = useHostCommand<{ ok: boolean }>("settings.update")

    async function save(changed: Record<string, unknown>) {
      for (const [key, value] of Object.entries(changed)) {
        const result = await update.execute({ key, value, scope: "app" })
        // Stop at the first failure rather than firing the rest blind. The
        // operator sees which key failed and the ones after it are untouched
        // rather than half-applied.
        if (result === undefined) return
      }
    }

    return (
      <>
        <CommandAlert title="Could not save" error={update.error} />
        <QueryBoundary title={namespace} query={query}>
          {(data) => {
            const fields = flattenCategories(data)
            return (
              <SettingsForm
                // Remount when the data changes, per the kit consumer notes:
                // the form seeds its draft once on mount and does not re-seed.
                key={`${namespace}:${fields.length}`}
                fields={toDescriptors(fields)}
                saving={update.loading}
                onSave={(changed) => void save(changed)}
                emptyMessage="This plugin has nothing to configure."
              />
            )
          }}
        </QueryBoundary>
      </>
    )
  }

  SettingsPanel.displayName = `SettingsPanel(${namespace})`
  return SettingsPanel
}
