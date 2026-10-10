import { useState } from "react"
import type { ReactNode } from "react"
import {
  PluginLink,
  useQuery,
  useSlotEntries,
} from "@forge-go/dashboard-plugin"
import type { SlotEntry } from "@forge-go/dashboard-plugin"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@forge-go/dashboard-kit/components/tabs"
import { Panel, ResourceTable, type Column } from "../components/presentation"
import { SettingsNamespaceBody } from "./settings-namespace"

export interface NamespaceSummary {
  name: string
  displayName?: string
  description?: string
  settingCount: number
}

export interface NamespacesList {
  namespaces: NamespaceSummary[]
  context?: { appId?: string; orgId?: string; userId?: string }
}

const columns: Column<NamespaceSummary>[] = [
  {
    id: "namespace",
    header: "Namespace",
    cell: (namespace) => (
      <PluginLink
        to={`/settings/${namespace.name}`}
        className="font-medium hover:underline"
      >
        {namespace.displayName || namespace.name}
      </PluginLink>
    ),
  },
  {
    id: "description",
    header: "Description",
    cell: (namespace) =>
      namespace.description || <NoneCell label="description" />,
  },
  {
    id: "settingCount",
    header: "Settings",
    cell: (namespace) => namespace.settingCount,
  },
]

/** The backend registry is the source of truth for installed settings. */
function settingsChoices(namespaces: NamespaceSummary[], entries: SlotEntry[]) {
  const choices: {
    key: string
    label: string
    namespace: string
    node: ReactNode
  }[] = namespaces.map((namespace) => {
    const contribution = entries.find(
      (entry) =>
        entry.extension === namespace.name || entry.id === namespace.name
    )
    return {
      key: `namespace:${namespace.name}`,
      label: namespace.displayName || namespace.name,
      namespace: namespace.name,
      node: contribution?.node ?? (
        <SettingsNamespaceBody namespace={namespace.name} embedded />
      ),
    }
  })

  // A contribution can have its own panel even without a registered settings
  // namespace. Keep those panels reachable while the plugin remains installed.
  for (const entry of entries) {
    if (
      namespaces.some(
        (namespace) =>
          namespace.name === entry.extension || namespace.name === entry.id
      )
    )
      continue
    choices.push({
      key: entry.key,
      label: entry.label ?? entry.id,
      namespace: entry.extension,
      node: entry.node,
    })
  }
  return choices
}

function SettingsDirectory({
  namespaces,
  entries,
}: {
  namespaces: NamespaceSummary[]
  entries: SlotEntry[]
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [visited, setVisited] = useState<string[]>([])
  const choices = settingsChoices(namespaces, entries)
  const active =
    choices.find((choice) => choice.key === selected)?.key ?? choices[0]?.key
  const caption = `${namespaces.length} ${namespaces.length === 1 ? "namespace" : "namespaces"}`

  function select(key: string) {
    setVisited((previous) => [...new Set([...previous, active ?? key, key])])
    setSelected(key)
  }

  return (
    <>
      <Panel
        title="Configuration namespaces"
        description="Settings registered by the installed authentication plugins."
      >
        <ResourceTable<NamespaceSummary>
          columns={columns}
          rows={namespaces}
          rowKey={(namespace) => namespace.name}
          caption={caption}
          emptyMessage="No settings namespaces yet."
        />
      </Panel>

      {choices.length > 0 && (
        <Panel
          title="Plugin settings"
          description="Choose a plugin to configure. Unsaved edits stay here while you switch between plugins."
        >
          <Tabs
            value={active}
            orientation="vertical"
            onValueChange={(value) => select(String(value))}
            className="min-w-0-col flex gap-4 @3xl/main:flex-row"
          >
            <div className="@3xl/main:hidden">
              <NativeSelect
                aria-label="Choose plugin settings"
                value={active}
                onChange={(event) => select(event.target.value)}
              >
                {choices.map((choice) => (
                  <NativeSelectOption key={choice.key} value={choice.key}>
                    {choice.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <TabsList
              aria-label="Plugin settings"
              className="hidden w-full shrink-0 items-stretch justify-start gap-1 bg-transparent p-0 @3xl/main:flex @3xl/main:max-h-[32rem] @3xl/main:w-48 @3xl/main:overflow-y-auto"
            >
              {choices.map((choice) => (
                <TabsTrigger
                  key={choice.key}
                  value={choice.key}
                  className="min-h-9 flex-none px-3 data-active:border-border data-active:bg-muted data-active:shadow-none"
                >
                  {choice.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {choices.map((choice) => (
              <TabsContent
                key={choice.key}
                value={choice.key}
                keepMounted
                className="min-w-0"
              >
                {(choice.key === active || visited.includes(choice.key)) && (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <h3 className="font-medium">{choice.label}</h3>
                      <p className="font-mono text-xs text-muted-foreground">
                        {choice.namespace}
                      </p>
                    </div>
                    {choice.node}
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </Panel>
      )}
    </>
  )
}

export function AuthSettingsPage() {
  const list = useQuery<NamespacesList>("settings.namespaces")
  const entries = useSlotEntries("settings.tabs")

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Settings"
        description="Configure authentication policies for the selected application."
      />
      <QueryBoundary title="Settings" query={list} skeletonRows={5}>
        {(data) => (
          <SettingsDirectory
            namespaces={data.namespaces ?? []}
            entries={entries}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
