import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { SettingsForm } from "@forge-go/dashboard-kit/components/settings-form"
import { flattenCategories, toDescriptors } from "../settings-fields"
import type { SettingsNamespaceResponse } from "../settings-fields"
import type { AckResponse } from "./users"

export function AuthSettingsNamespacePage({ params }: PluginPageProps) {
  const namespace = params.namespace
  if (!namespace) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No namespace selected.
      </p>
    )
  }
  return <SettingsNamespaceBody namespace={namespace} />
}

function SettingsNamespaceBody({ namespace }: { namespace: string }) {
  const query = useQuery<SettingsNamespaceResponse>("settings.namespace", {
    namespace,
    scope: "app",
  })
  const update = useCommand<AckResponse>("settings.update")

  /**
   * One `settings.update` per changed key, because the intent writes one key
   * at a time. Stops at the first failure rather than firing the rest blind:
   * the operator sees which key failed, and the ones after it are untouched
   * rather than half-applied.
   *
   * There is deliberately no way to send a value of `null` here.
   * `settings.update` passes its value straight through to `Manager.Set`
   * with no null check, so that would store a literal null rather than
   * clearing an override. The `Delete` path that would actually clear one
   * exists in Go and no intent reaches it yet, so this page offers no
   * "reset to default" control.
   */
  async function save(changed: Record<string, unknown>) {
    for (const [key, value] of Object.entries(changed)) {
      const result = await update.execute({ key, value, scope: "app" })
      if (result === undefined) return
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Settings" query={query} skeletonRows={5}>
        {(data) => {
          const fields = flattenCategories(data)

          return (
            <>
              <PageHeader title={data.displayName || namespace} />
              <CommandAlert error={update.error} title="Could not save" />
              <SettingsForm
                // Remount when the data changes, per the kit consumer notes:
                // the form seeds its draft once on mount and does not
                // re-seed, so a stale key would leave an operator editing
                // against data the server has already replaced.
                key={`${namespace}:${fields.length}`}
                fields={toDescriptors(fields)}
                saving={update.loading}
                onSave={(changed) => void save(changed)}
              />
            </>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
