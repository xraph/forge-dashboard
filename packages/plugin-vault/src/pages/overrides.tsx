import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { WrongTypeBadge } from "../badges"
import { ConfigValue } from "../components/config-value"
import { useRevertOverride } from "../components/revert-override"
import type { OverrideSummary } from "../config-types"
import { configPath } from "../keys"

const PAGE_SIZE = 25

/** Mirrors the Go `overridesListResponse`. Lists are never null. */
interface OverridesList {
  overrides: OverrideSummary[]
  total: number
}

/** One choice, never two: the store lists overrides by tenant or by key. */
type Choice = { kind: "tenant" | "key"; value: string }

/**
 * Every override of one tenant, or of one key.
 *
 * The store can list overrides only one way at a time, and it refuses a
 * request with neither ("give a tenantId or a key"), so this page asks first
 * and reads nothing until there is a choice. The two inputs are mutually
 * exclusive: choosing one empties the other, and a request carries the one
 * that is active and never both.
 *
 * Reverting is `overrides.delete` behind the same confirmation the entry page
 * uses. An override whose key has no entry any more (an orphan) is listed, is
 * marked "Key deleted", links nowhere, and offers only the revert.
 */
export const OverridesPage: ComponentType<PluginPageProps> = () => {
  const [tenantText, setTenantText] = useState("")
  const [keyText, setKeyText] = useState("")
  const [choice, setChoice] = useState<Choice | null>(null)
  // One-based, matching ResourceTable's PaginationState.
  const [page, setPage] = useState(1)
  const revert = useRevertOverride()

  function choose(kind: Choice["kind"], text: string) {
    const value = text.trim()
    if (value === "") return
    setChoice({ kind, value })
    // A new choice starts at page one: page three of one tenant is not page
    // three of another.
    setPage(1)
    if (kind === "tenant") {
      setTenantText(value)
      setKeyText("")
    } else {
      setKeyText(value)
      setTenantText("")
    }
  }

  function clear() {
    setChoice(null)
    setTenantText("")
    setKeyText("")
    setPage(1)
  }

  const list = useQuery<OverridesList>(
    "overrides.list",
    {
      ...(choice === null
        ? {}
        : choice.kind === "tenant"
          ? { tenantId: choice.value }
          : { key: choice.value }),
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    },
    { enabled: choice !== null },
  )

  // Reverting the last row of a page leaves the page past the end: go to the
  // last page there is. Adjusted while rendering, from the total this very page
  // reported, so it never fires while a new page is still loading (no total).
  const total = list.data?.total
  if (total !== undefined && page > Math.max(1, Math.ceil(total / PAGE_SIZE))) {
    setPage(Math.max(1, Math.ceil(total / PAGE_SIZE)))
  }

  const columns: Column<OverrideSummary>[] = [
    {
      id: "key",
      header: "Key",
      className: "font-mono text-xs font-medium",
      cell: (o) =>
        o.keyExists ? (
          <PluginLink to={configPath(o.key)}>{o.key}</PluginLink>
        ) : (
          // The entry is gone, so a link would land on "no such entry".
          <span className="flex flex-wrap items-center gap-1.5">
            <span>{o.key}</span>
            <Badge variant="destructive">Key deleted</Badge>
          </span>
        ),
    },
    {
      id: "tenant",
      header: "Tenant",
      className: "font-mono text-xs",
      cell: (o) => o.tenantId,
    },
    {
      id: "value",
      header: "Value",
      cell: (o) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {/* The type is the entry's, and the list does not carry it. */}
          <ConfigValue value={o.value} valueType="" />
          {/* An orphan is judged against no type, so it always says false. */}
          {o.valueMatchesType || !o.keyExists ? null : <WrongTypeBadge />}
        </span>
      ),
    },
    {
      id: "updated",
      header: "Updated",
      cell: (o) => <Timestamp value={o.updatedAt} label="update time" />,
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Overrides"
        description="The values tenants get in place of an entry's app default."
      />

      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <ChoiceForm
          id="overrides-tenant"
          label="Tenant id"
          button="Show overrides for a tenant"
          text={tenantText}
          onText={setTenantText}
          active={choice?.kind === "tenant"}
          onChoose={() => choose("tenant", tenantText)}
        />
        <ChoiceForm
          id="overrides-key"
          label="Config key"
          button="Show overrides for a key"
          text={keyText}
          onText={setKeyText}
          active={choice?.kind === "key"}
          onChoose={() => choose("key", keyText)}
        />
        {choice === null ? null : (
          <IconButton type="button" variant="outline" onClick={clear} label="Clear" />
        )}
      </div>

      {choice === null ? (
        <p className="text-sm text-muted-foreground">
          Pick a tenant or a key to see its overrides. The store can only list them one way at a
          time.
        </p>
      ) : (
        <QueryBoundary title="Overrides" query={list} skeletonRows={4}>
          {(data) => {
            const rows = data.overrides ?? []
            // The server's total, never the page length.
            const caption = `${data.total} override${data.total === 1 ? "" : "s"}`
            return (
              <ResourceTable<OverrideSummary>
                columns={columns}
                rows={rows}
                rowKey={(o) => `${o.tenantId}\u0000${o.key}`}
                caption={caption}
                emptyMessage={
                  choice.kind === "tenant"
                    ? `No overrides for tenant ${choice.value}.`
                    : `No overrides for key ${choice.value}.`
                }
                rowActions={(o) => (
                  <IconButton variant="outline" onClick={() =>
                      o.keyExists
                        ? revert.request(
                            o.key,
                            o.tenantId,
                            `Tenant ${o.tenantId} goes back to the app default for ${o.key}.`,
                          )
                        : // The key is gone, so there is no app default to go back to.
                          revert.request(
                            o.key,
                            o.tenantId,
                            `Tenant ${o.tenantId}'s override of ${o.key} is removed. That key no longer exists, so apps reading it fall back to their own default.`,
                            true,
                          )
                    } label={
                      o.keyExists
                        ? `Revert to app default for tenant ${o.tenantId} of ${o.key}`
                        : `Remove leftover override for tenant ${o.tenantId} of ${o.key}`
                    } />
                )}
                pagination={{ page, pageSize: PAGE_SIZE, total: data.total }}
                onPageChange={setPage}
              />
            )
          }}
        </QueryBoundary>
      )}
      {revert.dialog}
    </section>
  )
}

function ChoiceForm({
  id,
  label,
  button,
  text,
  onText,
  active,
  onChoose,
}: {
  id: string
  label: string
  button: string
  text: string
  onText: (next: string) => void
  active: boolean
  onChoose: () => void
}) {
  function submit(event: FormEvent) {
    event.preventDefault()
    // Enter in the field asks, unless there is nothing to ask about.
    if (text.trim() !== "") onChoose()
  }
  return (
    <form onSubmit={submit} aria-label={button} className="flex items-end gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </Label>
        <Input
          id={id}
          className="w-56 font-mono"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => onText(e.target.value)}
        />
      </div>
      <Button type="submit" variant={active ? "default" : "outline"} disabled={text.trim() === ""}>
        {button}
      </Button>
    </form>
  )
}
