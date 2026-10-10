import { useMemo, useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { KeyStateBadge } from "../badges"
import { CreateKeyDialog } from "../components/create-key-dialog"
import { ENVIRONMENTS, keyPath, maskedKey, policyPath, STATES } from "../format"
import { useHeldPage } from "../held-page"
import type { KeysList, KeySummary, PoliciesList } from "../types"

const PAGE_SIZE = 25

const ALL = { value: "", label: "All" }

// The same read the key forms' pickers make, so the three share one entry.
const POLICY_PARAMS = { limit: 200 }

/**
 * A key's policy by name, linked to its page. The id stands in, as a raw
 * value, when the name is not known: policies.list is still loading, it
 * failed, or the policy is past the first 200.
 */
function PolicyCell({
  id,
  names,
}: {
  id?: string
  names: ReadonlyMap<string, string>
}) {
  if (!id) return <NoneCell label="policy" />
  const name = names.get(id)
  if (name === undefined) {
    return <span className="font-mono text-xs">{id}</span>
  }
  return <PluginLink to={policyPath(id)}>{name}</PluginLink>
}

function columnsFor(
  policyNames: ReadonlyMap<string, string>
): Column<KeySummary>[] {
  return [
    {
      id: "name",
      header: "Name",
      className: "font-medium",
      cell: (k) => <PluginLink to={keyPath(k.id)}>{k.name}</PluginLink>,
    },
    {
      id: "key",
      header: "Key",
      className: "font-mono text-xs",
      cell: (k) => maskedKey(k),
    },
    {
      id: "environment",
      header: "Environment",
      cell: (k) => k.environment,
    },
    {
      id: "state",
      header: "State",
      cell: (k) => <KeyStateBadge summary={k} />,
    },
    {
      id: "policy",
      header: "Policy",
      cell: (k) => <PolicyCell id={k.policyId} names={policyNames} />,
    },
    {
      id: "scopes",
      header: "Scopes",
      cell: (k) => <TagList values={k.scopes} label="scopes" />,
    },
    {
      id: "lastUsed",
      header: "Last used",
      cell: (k) => <Timestamp value={k.lastUsedAt} label="recorded use" />,
    },
    {
      id: "expires",
      header: "Expires",
      cell: (k) => <Timestamp value={k.expiresAt} label="expiry" />,
    },
  ]
}

export const KeysPage: ComponentType<PluginPageProps> = () => {
  // One-based, matching ResourceTable's PaginationState.
  const [page, setPage] = useState(1)
  const [environment, setEnvironment] = useState("")
  const [state, setState] = useState("")
  const [policyId, setPolicyId] = useState("")
  const [creating, setCreating] = useState(false)

  // Names only. A failed or slow read leaves the ids showing and the policy
  // filter at All, and never holds up the key list itself.
  const policies = useQuery<PoliciesList>("policies.list", POLICY_PARAMS)
  const policyData = policies.data
  const columns = useMemo(
    () =>
      columnsFor(
        new Map((policyData?.policies ?? []).map((p) => [p.id, p.name]))
      ),
    [policyData]
  )
  // Names shown, ids sent. A policy past the first 200 cannot be picked here;
  // its own page lists its keys.
  const policyOptions = useMemo(
    () => [
      ALL,
      ...(policyData?.policies ?? []).map((p) => ({
        value: p.id,
        label: p.name,
      })),
    ],
    [policyData]
  )

  // An empty filter is left out of the params rather than sent as "".
  // `list` is what the table shows: the page on screen stays while the next
  // one loads, so the pager keeps the focus of the button you pressed.
  const { shown: list, read } = useHeldPage<KeysList>(
    "keys.list",
    {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      ...(environment !== "" && { environment }),
      ...(state !== "" && { state }),
      ...(policyId !== "" && { policyId }),
    },
    JSON.stringify([environment, state, policyId]),
    page
  )

  // The data can shrink under the page being viewed (keys deleted elsewhere),
  // leaving a page past the end: rows empty, total still positive. Step back
  // to the last page that exists. Done during render, React's supported way to
  // adjust state from data, so no frame shows the empty page. Only when that
  // page is a different one: an empty last page would otherwise set the page
  // it is already on and render forever.
  // The page's own answer, never the held one: the page before it is not
  // evidence that this one ran past the end.
  const total = read.data?.total
  const rowCount = read.data?.keys?.length
  if (page > 1 && total !== undefined && total > 0 && rowCount === 0) {
    const last = Math.max(1, Math.ceil(total / PAGE_SIZE))
    if (last !== page) setPage(last)
  }

  const filtered = environment !== "" || state !== "" || policyId !== ""

  // A new filter means a new result set, and page 3 of it may not exist.
  function changeEnvironment(value: string) {
    setEnvironment(value)
    setPage(1)
  }
  function changeState(value: string) {
    setState(value)
    setPage(1)
  }
  function changePolicy(value: string) {
    setPolicyId(value)
    setPage(1)
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="API keys"
        description="Keys are shown by prefix and last four characters. The full value is only ever shown once, when a key is created or rotated."
        actions={<Button onClick={() => setCreating(true)}>Create key</Button>}
      />

      <div className="flex min-w-0 flex-col gap-1.5">
        <FilterBar
          filters={[
            {
              id: "environment",
              label: "Environment",
              value: environment,
              options: [ALL, ...ENVIRONMENTS],
              onChange: changeEnvironment,
            },
            {
              id: "state",
              label: "State",
              value: state,
              options: [ALL, ...STATES],
              onChange: changeState,
            },
            {
              id: "policy",
              label: "Policy",
              value: policyId,
              options: policyOptions,
              onChange: changePolicy,
            },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          State filters match the recorded state. A key past its expiry is
          marked expired the next time it is used.
        </p>
      </div>

      <QueryBoundary
        title="API keys"
        query={list}
        skeletonRows={5}
        keepPreviousData
      >
        {(data) => {
          const rows = data.keys ?? []
          // The server's total, never the page length.
          const caption = `${data.total} ${data.total === 1 ? "key" : "keys"}`
          return (
            <ResourceTable<KeySummary>
              columns={columns}
              rows={rows}
              rowKey={(k) => k.id}
              caption={caption}
              emptyMessage={
                // Three kinds of empty: none yet, none matching, and (above)
                // a page past the end. Say which one this is.
                filtered ? "No keys match these filters." : "No API keys yet."
              }
              // Only for "none yet". A filter that matches nothing is not the
              // moment to offer a key.
              emptyAction={
                filtered ? undefined : (
                  <Button onClick={() => setCreating(true)}>Create key</Button>
                )
              }
              pagination={{ page, pageSize: PAGE_SIZE, total: data.total }}
              onPageChange={setPage}
            />
          )
        }}
      </QueryBoundary>

      {/* Outside the boundary, keepPreviousData or not: it shows a raw key,
          and nothing holding one sits under a boundary. */}
      <CreateKeyDialog open={creating} onOpenChange={setCreating} />
    </section>
  )
}
