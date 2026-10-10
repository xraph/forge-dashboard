import { useState } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import {
  Alert,
  AlertDescription,
} from "@forge-go/dashboard-kit/components/alert"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import {
  NamespaceCell,
  emptyListMessage,
  namespaceOptions,
  useNamespaceFilter,
  type NamespacesResponse,
} from "../components/namespace-filter"
import type { ConfigDetail } from "./config"
import type { AckResponse } from "./roles"

/**
 * What a policy will do right now, as the server's analysis computes it. The
 * values are the `State*` constants in `policy_analysis.go`.
 *
 * `never` is a window that closes before it opens. It is not the same as
 * `expired`, which was in effect once.
 */
export type PolicyState =
  "active" | "inactive" | "scheduled" | "expired" | "never"

/**
 * Mirrors the Go `PolicySummary`. Field names are its JSON tags.
 *
 * `state`, `failsClosed`, `neverApplies` and `matchesEverything` are computed
 * by the server at read time and never stored, because the stored fields do
 * not say them: an allow whose condition throws looks exactly like a working
 * allow. This page renders them and never derives them.
 */
export interface PolicySummary {
  id: string
  namespacePath: string
  name: string
  description?: string
  effect: string
  priority: number
  isActive: boolean
  state: PolicyState
  failsClosed: boolean
  neverApplies: boolean
  matchesEverything: boolean
  version: number
  updatedAt: string
}

/** Mirrors the Go `PoliciesListResponse`: PageMeta embedded beside items. */
export interface PoliciesList {
  items: PolicySummary[]
  total: number
  limit: number
  offset: number
}

/**
 * The query the list sends, mirroring the Go `PoliciesListInput`.
 * `namespacePath` is a pointer there: absent means every namespace and ""
 * means the tenant root only. Every other field is absent when unset.
 */
export interface PoliciesListParams {
  namespacePath?: string
  effect?: string
  isActive?: boolean
  search?: string
  limit: number
  offset: number
}

/**
 * The create payload. The Go `PolicyCreateInput` embeds `PolicyDraft`, whose
 * `name` and `effect` tags these are, beside its own `namespacePath`. The rest
 * of the draft (priority, window, matchers, conditions) is written on the
 * policy's own page, where the validator has a row to point at.
 */
export interface PolicyCreatePayload {
  name: string
  effect: string
  namespacePath: string
}

/**
 * The closed set the server accepts. It refuses anything else with "Effect
 * must be allow or deny", so a free-text field would only defer the error.
 */
const EFFECTS = ["allow", "deny"] as const

const PAGE_SIZE = 25

const ABAC_OFF =
  "Policy evaluation is turned off in this deployment, so none of these policies take effect."

type ActiveFilter = "" | "true" | "false"

interface Flag {
  label: string
  variant: "secondary" | "destructive"
  title: string
}

/**
 * The badges a row earns, in the order they read.
 *
 * By proportion: most policies are active and behave as written, so an active
 * one earns nothing and the exceptions are what stand out. Deliberate states
 * take `secondary`. Broken ones take `destructive`, because they are what an
 * operator opened this page to find. Several can apply at once.
 */
function flagsOf(p: PolicySummary): Flag[] {
  const out: Flag[] = []
  if (p.state === "inactive") {
    out.push({
      label: "inactive",
      variant: "secondary",
      title: "Switched off, so it takes no part in any check",
    })
  } else if (p.state === "scheduled") {
    out.push({
      label: "not yet in effect",
      variant: "secondary",
      title: "Its window has not opened yet",
    })
  } else if (p.state === "expired") {
    out.push({
      label: "expired",
      variant: "secondary",
      title: "Its window has closed",
    })
  } else if (p.state === "never") {
    out.push({
      label: "never in effect",
      variant: "destructive",
      title: "Its window closes before it opens, so it is never in effect",
    })
  }
  if (p.failsClosed) {
    out.push({
      label: "fails closed",
      variant: "destructive",
      title:
        "A condition cannot be evaluated, so warden treats it, and every condition after it, as met",
    })
  }
  if (p.neverApplies) {
    out.push({
      label: "never applies",
      variant: "destructive",
      title: "A condition can never hold, so this policy never matches a check",
    })
  }
  if (p.matchesEverything) {
    out.push({
      label: "matches every check",
      variant: "secondary",
      title:
        "No matcher or condition narrows it, so while it is in effect it matches every check in its namespace and below",
    })
  }
  return out
}

function StatusCell({ p }: { p: PolicySummary }) {
  const flags = flagsOf(p)
  // Never a blank cell: blank reads as loading or broken, and is silent to a
  // screen reader.
  if (flags.length === 0) return <span className="sr-only">Active</span>
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f.label} variant={f.variant} title={f.title}>
          {f.label}
        </Badge>
      ))}
    </span>
  )
}

/**
 * Says which kind of empty the list is, including the two filters
 * emptyListMessage does not know about. Without this an effect filter that
 * excluded everything would read "No policies yet", which says nothing exists
 * when something does.
 */
function emptyMessage(
  search: string,
  namespace: string,
  effect: string,
  active: ActiveFilter
): string {
  if (effect === "" && active === "") {
    return emptyListMessage("policies", search, namespace)
  }
  const noun = [
    active === "true" ? "active" : active === "false" ? "inactive" : "",
    effect,
    "policies",
  ]
    .filter(Boolean)
    .join(" ")
  const message = emptyListMessage(noun, search, namespace)
  return message.endsWith(" yet.") ? `No ${noun} found.` : message
}

function NamespaceSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (path: string) => void
}) {
  // Mounted only while the dialog is open. The query is the one the filter
  // already made, so it is served from the store rather than asked twice.
  const list = useQuery<NamespacesResponse>("namespaces.list")
  const options = namespaceOptions(list.data?.namespaces ?? [""]).filter(
    (o) => o.value !== "all"
  )
  // A namespace the list does not know still has to be selectable when it is
  // the one on screen, or the select would show a value it cannot hold.
  if (!options.some((o) => o.value === value)) {
    options.push({ label: value, value })
  }
  return (
    <span className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor="policy-namespace">Namespace</Label>
      <NativeSelect
        id="policy-namespace"
        className="w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <NativeSelectOption key={o.value} value={o.value}>
            {o.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </span>
  )
}

export function WardenPoliciesPage() {
  // One-based, matching ResourceTable's PaginationState.
  const [page, setPage] = useState(1)
  const namespace = useNamespaceFilter(() => setPage(1))
  const [search, setSearch] = useState("")
  const [effect, setEffect] = useState("")
  const [active, setActive] = useState<ActiveFilter>("")
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [newEffect, setNewEffect] = useState("")
  const [newNamespace, setNewNamespace] = useState("")

  const navigate = useNavigateTo()
  const config = useQuery<ConfigDetail>("config.detail")

  // Trimmed, and absent when empty: an absent field is the honest way to say
  // "no filter", and a search of spaces is not one.
  const trimmedSearch = search.trim()
  const params: PoliciesListParams = {
    ...namespace.param,
    ...(effect !== "" && { effect }),
    ...(active !== "" && { isActive: active === "true" }),
    ...(trimmedSearch !== "" && { search: trimmedSearch }),
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  }
  const list = useQuery<PoliciesList>("policies.list", { ...params })
  const create = useCommand<AckResponse>("policies.create")

  // Only an explicit false. A config that failed to load says nothing, and the
  // page must not claim evaluation is off on the strength of an error.
  const abacOff = config.data?.abacEnabled === false
  const missing = name.trim() === "" || newEffect === ""

  function openCreate() {
    // Reset at open, not at close: the operator is about to read whatever
    // this dialog shows, so a failure from an earlier attempt must not greet
    // them, and neither must what they typed then.
    create.reset()
    setName("")
    setNewEffect("")
    setNewNamespace(namespace.value === "all" ? "" : namespace.value)
    setCreating(true)
  }

  async function confirmCreate() {
    if (missing) return
    // Exactly these three keys. The server stores a create inactive whatever
    // else it is sent, and the rest of the draft is written on the policy's
    // own page.
    const payload: PolicyCreatePayload = {
      name: name.trim(),
      effect: newEffect,
      namespacePath: newNamespace,
    }
    const result = await create.execute(payload)
    // execute resolves undefined only when the client throws, so this is the
    // success check. A refused create must leave the dialog open with what
    // the operator typed.
    if (result === undefined) return
    setCreating(false)
    // The dedicated edit route, not a query string: a plugin cannot read one.
    if (result.id) navigate(`/policies/${result.id}/edit`)
  }

  const columns: Column<PolicySummary>[] = [
    {
      id: "name",
      header: "Name",
      cell: (p) => (
        <PluginLink
          to={`/policies/${p.id}`}
          className="underline underline-offset-4"
        >
          {p.name}
        </PluginLink>
      ),
      className: "font-medium",
    },
    {
      // Plain text on purpose. The list is a scan, and the status column
      // carries the exceptions. Colouring allow and deny would make every
      // row shout and bury the ones that are actually wrong.
      id: "effect",
      header: "Effect",
      cell: (p) => p.effect,
    },
    {
      id: "status",
      header: "Status",
      cell: (p) => <StatusCell p={p} />,
    },
    {
      id: "namespace",
      header: "Namespace",
      cell: (p) => <NamespaceCell path={p.namespacePath} />,
    },
    {
      id: "priority",
      header: "Priority",
      cell: (p) => p.priority,
      className: "tabular-nums",
    },
    {
      id: "updatedAt",
      header: "Updated",
      cell: (p) => <Timestamp value={p.updatedAt} label="updated at" />,
    },
  ]

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Policies"
        actions={<Button onClick={openCreate}>New policy</Button>}
      />

      {abacOff && (
        <Alert>
          <AlertDescription>{ABAC_OFF}</AlertDescription>
        </Alert>
      )}

      <p className="text-sm text-muted-foreground">
        A policy allows or denies a check when its subjects, actions, resources
        and conditions match. The status column says what each one will actually
        do, and nothing shows for a policy that is active and behaves as
        written.
      </p>

      <FilterBar
        search={{
          value: search,
          onChange: (v) => {
            setSearch(v)
            setPage(1)
          },
          placeholder: "Search by name",
          label: "Search policies",
        }}
        filters={[
          namespace.filterConfig,
          {
            id: "effect",
            label: "Effect",
            value: effect,
            options: [
              { label: "Any effect", value: "" },
              ...EFFECTS.map((e) => ({ label: e, value: e })),
            ],
            onChange: (v) => {
              setEffect(v)
              setPage(1)
            },
          },
          {
            id: "active",
            label: "Active",
            value: active,
            options: [
              { label: "Any", value: "" },
              { label: "Active", value: "true" },
              { label: "Inactive", value: "false" },
            ],
            onChange: (v) => {
              setActive(v as ActiveFilter)
              setPage(1)
            },
          },
        ]}
      />

      <QueryBoundary title="Policies" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.items ?? []
          // The server's total, never rows.length: rows is one page.
          const caption = `${data.total} ${data.total === 1 ? "policy" : "policies"}`
          return (
            <ResourceTable<PolicySummary>
              columns={columns}
              rows={rows}
              rowKey={(p) => p.id}
              caption={caption}
              emptyMessage={emptyMessage(
                trimmedSearch,
                namespace.value,
                effect,
                active
              )}
              pagination={{ page, pageSize: data.limit, total: data.total }}
              onPageChange={setPage}
            />
          )
        }}
      </QueryBoundary>

      {/* The error lives inside the dialog. Base UI marks everything outside
          an open dialog inert and aria-hidden, so an alert on the page body
          is unreachable while the dialog that can fail is open. */}
      <ConfirmDialog
        open={creating}
        onOpenChange={(open) => !open && setCreating(false)}
        title="New policy"
        destructive={false}
        confirmLabel="Create policy"
        pending={create.loading}
        confirmDisabled={missing}
        onConfirm={() => void confirmCreate()}
        description={
          // With evaluation off, activating takes no effect either, so the
          // dialog promises nothing about it. Only an explicit false from
          // config.detail says so, never an unreadable config.
          abacOff
            ? "It starts inactive."
            : "It starts inactive, so it takes no effect until you activate it."
        }
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="policy-name">Name</Label>
          <Input
            id="policy-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="policy-effect">Effect</Label>
          <NativeSelect
            id="policy-effect"
            className="w-full"
            value={newEffect}
            onChange={(e) => setNewEffect(e.target.value)}
          >
            <NativeSelectOption value="">Choose an effect</NativeSelectOption>
            {EFFECTS.map((e) => (
              <NativeSelectOption key={e} value={e}>
                {e}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <NamespaceSelect value={newNamespace} onChange={setNewNamespace} />
        <CommandAlert
          error={create.error}
          title="Could not create the policy"
        />
      </ConfirmDialog>
    </section>
  )
}
