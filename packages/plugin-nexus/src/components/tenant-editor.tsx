import { useRef, useState } from "react"
import { PluginLink, useCommand } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { NativeSelect } from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  quotaLabels,
  tenantDraft,
  tenantPayload,
  type TenantDraft,
} from "../tenant-form"
import { tenantPath } from "../format"
import type { Quota, Tenant } from "../types"
import { MetadataFields } from "./metadata-fields"
import { Empty, Notice, Section } from "./read"

export function TenantEditor({ tenant }: { tenant?: Tenant }) {
  return <Editor key={tenant?.id ?? "new"} tenant={tenant} />
}
function Editor({ tenant }: { tenant?: Tenant }) {
  const [original] = useState(tenant)
  const [draft, setDraft] = useState(() => tenantDraft(tenant))
  const [problem, setProblem] = useState("")
  const [saved, setSaved] = useState<Tenant>()
  const command = useCommand<Tenant>(
    original ? "tenants.update" : "tenants.create"
  )
  const sending = useRef(false)
  let changed = true
  try {
    changed =
      !original || Object.keys(tenantPayload(draft, original)).length > 1
  } catch {
    /* Validate on submission. */
  }
  const config = <K extends keyof TenantDraft["config"]>(
    key: K,
    value: TenantDraft["config"][K]
  ) =>
    setDraft((current) => ({
      ...current,
      config: { ...current.config, [key]: value },
    }))
  async function submit() {
    if (sending.current || !changed) return
    let payload
    try {
      payload = tenantPayload(draft, original)
      setProblem("")
    } catch (error) {
      setProblem((error as Error).message)
      return
    }
    sending.current = true
    try {
      const result = await command.execute(payload)
      if (result) {
        setSaved(result)
        command.reset()
      }
    } finally {
      sending.current = false
    }
  }
  if (saved)
    return (
      <Empty
        title={original ? "Tenant saved" : "Tenant created"}
        body={`${saved.name} is ready to review.`}
        action={<PluginLink to={tenantPath(saved.id)}>View tenant</PluginLink>}
      />
    )
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <PageHeader
        title={original ? `Edit ${original.name}` : "Create tenant"}
        description="Customer access, limits and gateway configuration."
        actions={
          <div className="flex items-center gap-3">
            <PluginLink to={original ? tenantPath(original.id) : "/tenants"}>
              Cancel
            </PluginLink>
            <Button
              type="submit"
              size="sm"
              disabled={command.loading || !changed}
            >
              {command.loading
                ? "Saving…"
                : original
                  ? "Save changes"
                  : "Create tenant"}
            </Button>
          </div>
        }
      />
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      <CommandAlert title="Tenant could not be saved" error={command.error} />
      <fieldset disabled={command.loading} className="space-y-4">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            Name
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="space-y-1 text-sm">
            Slug
            <Input
              value={draft.slug}
              readOnly={!!original}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
            />
            {original && (
              <span className="text-xs text-muted-foreground">
                Slug cannot be changed.
              </span>
            )}
          </label>
        </div>
        <Section title="Quotas">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {(Object.keys(quotaLabels) as (keyof Quota)[]).map((key) => (
              <div key={key} className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">{quotaLabels[key]}</span>
                  <div className="flex items-center gap-2 text-xs">
                    <Switch
                      size="sm"
                      aria-label={`No limit: ${quotaLabels[key]}`}
                      checked={draft.quota[key].unlimited}
                      onCheckedChange={(unlimited) =>
                        setDraft({
                          ...draft,
                          quota: {
                            ...draft.quota,
                            [key]: { ...draft.quota[key], unlimited },
                          },
                        })
                      }
                    />
                    No limit
                  </div>
                </div>
                <Input
                  aria-label={quotaLabels[key]}
                  inputMode={key === "monthlyBudgetUsd" ? "decimal" : "numeric"}
                  disabled={draft.quota[key].unlimited}
                  value={
                    draft.quota[key].unlimited ? "" : draft.quota[key].value
                  }
                  placeholder={
                    draft.quota[key].unlimited ? "No limit" : "Positive limit"
                  }
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      quota: {
                        ...draft.quota,
                        [key]: { ...draft.quota[key], value: e.target.value },
                      },
                    })
                  }
                />
              </div>
            ))}
          </div>
        </Section>
        <Notice>
          Monthly budgets use recorded priced spend and are soft limits.
          In-flight requests can exceed them. Collection must be enabled to
          enforce a budget.
        </Notice>
        <Section title="Configuration">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {(
              [
                ["defaultModel", "Default model"],
                ["allowedModels", "Allowed models"],
                ["blockedModels", "Blocked models"],
                ["routingStrategy", "Routing strategy"],
                ["guardrailPolicy", "Guardrail policy"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="space-y-1 text-sm">
                {label}
                <Input
                  value={draft.config[key]}
                  onChange={(e) => config(key, e.target.value)}
                />
                {key === "allowedModels" || key === "blockedModels" ? (
                  <span className="text-xs text-muted-foreground">
                    Comma-separated model IDs.
                    {key === "allowedModels" ? " Empty allows all models." : ""}
                  </span>
                ) : null}
                {key === "routingStrategy" || key === "guardrailPolicy" ? (
                  <span className="text-xs text-muted-foreground">
                    Stored, not enforced by the gateway.
                  </span>
                ) : null}
              </label>
            ))}
            <label className="space-y-1 text-sm">
              Cache
              <NativeSelect
                className="w-full"
                value={draft.config.cacheEnabled}
                onChange={(e) =>
                  config(
                    "cacheEnabled",
                    e.target.value as TenantDraft["config"]["cacheEnabled"]
                  )
                }
              >
                <option value="inherit">Inherit gateway setting</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </NativeSelect>
            </label>
          </div>
        </Section>
        <MetadataFields
          label="Tenant metadata"
          value={draft.metadata}
          onChange={(metadata) => setDraft({ ...draft, metadata })}
        />
        <MetadataFields
          label="Configuration metadata"
          value={draft.config.metadata}
          onChange={(value) => config("metadata", value)}
        />
      </fieldset>
    </form>
  )
}
