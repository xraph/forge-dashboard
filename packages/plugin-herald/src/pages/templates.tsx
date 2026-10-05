import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button, buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { EnabledBadge } from "../badges"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { CATEGORIES, plural } from "../format"
import { newTemplatePath, templatePath } from "../keys"
import type { TemplateSummary, TemplatesListResponse, TemplatesResetDefaultsResponse } from "../wire"

/** "fallback" for the "" locale, "fr (inactive)" for a version that answers nothing. */
function localeTags(t: TemplateSummary): string[] {
  return t.locales.map((l) => `${l.locale === "" ? "fallback" : l.locale}${l.active ? "" : " (inactive)"}`)
}

const columns: Column<TemplateSummary>[] = [
  { id: "name", header: "Name", className: "font-medium", cell: (t) => <PluginLink to={templatePath(t.id)}>{t.name}</PluginLink> },
  { id: "slug", header: "Slug", className: "font-mono text-xs", cell: (t) => t.slug },
  { id: "channel", header: "Channel", cell: (t) => t.channel },
  { id: "category", header: "Category", cell: (t) => t.category },
  { id: "locales", header: "Locales", cell: (t) => <TagList values={localeTags(t)} label="versions" /> },
  { id: "origin", header: "Origin", cell: (t) => (t.isSystem ? "System" : "Custom") },
  { id: "status", header: "Status", cell: (t) => <EnabledBadge enabled={t.enabled} /> },
]

function NewTemplateLink() {
  return (
    <PluginLink to={newTemplatePath} className={buttonVariants()}>
      New template
    </PluginLink>
  )
}

function TemplatesView({ startWithoutFallback }: { startWithoutFallback: boolean }) {
  const info = useEngineInfo()
  const [channel, setChannel] = useState("")
  const [category, setCategory] = useState("")
  const [fallback, setFallback] = useState(startWithoutFallback ? "missing" : "")
  const reset = useCommand<TemplatesResetDefaultsResponse>("templates.resetDefaults")
  const [confirming, setConfirming] = useState(false)

  // Absent, never "": params are the query's cache key.
  const params: Record<string, unknown> = {}
  if (channel) params.channel = channel
  if (category) params.category = category
  if (fallback === "missing") params.noFallback = true
  const list = useQuery<TemplatesListResponse>("templates.list", params)
  const filtered = channel !== "" || category !== "" || fallback !== ""
  const onlyMissingFallback = fallback === "missing" && channel === "" && category === ""

  function openReset() {
    reset.reset()
    setConfirming(true)
  }

  async function confirmReset() {
    const result = await reset.execute({})
    if (result === undefined) return
    setConfirming(false)
  }

  return (
    <section className="flex flex-col gap-4">
      <HeraldHeader
        title={startWithoutFallback ? "Templates without a fallback" : "Templates"}
        description={
          startWithoutFallback
            ? "A template with no live fallback version fails for any locale it doesn't list. Add a version with an empty locale to give it one."
            : "What Herald renders for each channel. A template answers a locale with its own version, its language, or the fallback version."
        }
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={openReset}>
              Reset system templates
            </Button>
            <NewTemplateLink />
          </div>
        }
      />
      <FilterBar
        filters={[
          { id: "channel", label: "Channel", value: channel, onChange: setChannel, options: [{ label: "All channels", value: "" }, ...(info.data?.channels ?? []).map((c) => ({ label: c, value: c }))] },
          { id: "category", label: "Category", value: category, onChange: setCategory, options: [{ label: "All categories", value: "" }, ...CATEGORIES.map((c) => ({ label: c, value: c }))] },
          { id: "fallback", label: "Fallback", value: fallback, onChange: setFallback, options: [{ label: "Any", value: "" }, { label: "Without a fallback version", value: "missing" }] },
        ]}
      />
      {reset.data && (
        <p role="status" className="text-sm">
          Removed {plural(reset.data.deleted, "system template")} and seeded {reset.data.seeded}.
        </p>
      )}
      <QueryBoundary title="Templates" query={list} skeletonRows={6}>
        {(data) => (
          <ResourceTable<TemplateSummary>
            columns={columns}
            rows={data.templates}
            rowKey={(t) => t.id}
            caption={plural(data.templates.length, "template")}
            emptyMessage={onlyMissingFallback ? "Every template has a fallback version." : filtered ? "No templates match these filters." : "No templates yet. Create one, or reset the system templates to get Herald's defaults."}
            emptyAction={filtered ? undefined : <NewTemplateLink />}
          />
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => !open && !reset.loading && setConfirming(false)}
        title="Reset the system templates?"
        description="This deletes every system template in this app and seeds Herald's defaults again. Custom templates are kept. Any edits you made to system templates are lost."
        confirmLabel="Reset"
        pending={reset.loading}
        onConfirm={() => void confirmReset()}
      >
        <CommandAlert error={reset.error} title="Could not reset the system templates" />
      </ConfirmDialog>
    </section>
  )
}

export const TemplatesPage: ComponentType<PluginPageProps> = () => <TemplatesView startWithoutFallback={false} />

/** The overview's "Show them" link lands here, already filtered. */
export const TemplatesWithoutFallbackPage: ComponentType<PluginPageProps> = () => <TemplatesView startWithoutFallback />
