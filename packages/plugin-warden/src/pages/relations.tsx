import { useState } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Button, buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import {
  NamespaceCell,
  emptyListMessage,
  namespaceOptions,
  useNamespaceFilter,
} from "../components/namespace-filter"
import type { NamespacesResponse } from "../components/namespace-filter"
import { relationGraphPath } from "../components/relation-graph-path"
import type { ResourceTypeGraph } from "../components/schema-graph"
import type { AckResponse } from "./roles"

/**
 * Mirrors the Go `RelationSummary`. Field names are its JSON tags.
 *
 * One tuple, `object#relation@subject`. `subjectRelation` is set only for a
 * userset subject such as `group:eng#member`, and absent (omitempty) for a
 * plain one.
 */
export interface RelationSummary {
  id: string
  namespacePath: string
  objectType: string
  objectId: string
  relation: string
  subjectType: string
  subjectId: string
  subjectRelation?: string
  createdBy?: string
  createdAt: string
}

/** Mirrors the Go `RelationsListResponse`: PageMeta embedded beside items. */
export interface RelationsList {
  items: RelationSummary[]
  total: number
  limit: number
  offset: number
}

const PAGE_SIZE = 25

/**
 * The parts of a tuple, in the order they read. Used for the filter inputs
 * and the create form alike, so the two cannot disagree about what a part is
 * called or how it is spelled on the wire.
 */
interface Parts {
  objectType: string
  objectId: string
  relation: string
  subjectType: string
  subjectId: string
  subjectRelation: string
}

const EMPTY_PARTS: Parts = {
  objectType: "",
  objectId: "",
  relation: "",
  subjectType: "",
  subjectId: "",
  subjectRelation: "",
}

/** The five parts the server refuses a tuple without, in its own order. */
const REQUIRED_PARTS = [
  "objectType",
  "objectId",
  "relation",
  "subjectType",
  "subjectId",
] as const

const PART_LABELS: Record<keyof Parts, string> = {
  objectType: "Object type",
  objectId: "Object id",
  relation: "Relation",
  subjectType: "Subject type",
  subjectId: "Subject id",
  subjectRelation: "Subject relation",
}

const PART_PLACEHOLDERS: Record<keyof Parts, string> = {
  objectType: "document",
  objectId: "readme",
  relation: "viewer",
  subjectType: "user",
  subjectId: "bob",
  subjectRelation: "member",
}

/**
 * The Zanzibar form of a tuple: `object#relation@subject`, with the userset
 * suffix `#subjectRelation` when the subject is a set rather than one member.
 * This is how warden's own docs and its DSL write it, and it is the string
 * somebody copies into a check.
 */
function tupleString(t: Omit<RelationSummary, "id" | "namespacePath" | "createdAt">) {
  const subject = `${t.subjectType}:${t.subjectId}`
  return (
    `${t.objectType}:${t.objectId}#${t.relation}@` +
    (t.subjectRelation ? `${subject}#${t.subjectRelation}` : subject)
  )
}

/** The trimmed, non-empty parts as wire fields: absent when unset, never "". */
function presentParts(parts: Parts): Partial<Parts> {
  const out: Partial<Parts> = {}
  for (const key of Object.keys(parts) as (keyof Parts)[]) {
    const value = parts[key].trim()
    if (value !== "") out[key] = value
  }
  return out
}

/**
 * The active filter written as a tuple pattern, `*` for a part left open, so
 * an empty result can name what it was asked for: `*:*#*@*:bob` is "anything
 * with bob as subject". Empty when no part filter is set.
 */
function filterPattern(parts: Parts): string {
  const p = presentParts(parts)
  if (Object.keys(p).length === 0) return ""
  const any = (v?: string) => v ?? "*"
  return (
    `${any(p.objectType)}:${any(p.objectId)}#${any(p.relation)}@` +
    `${any(p.subjectType)}:${any(p.subjectId)}` +
    (p.subjectRelation ? `#${p.subjectRelation}` : "")
  )
}

function PartInput({
  idPrefix,
  part,
  parts,
  onChange,
  optional,
  placeholder,
}: {
  idPrefix: string
  part: keyof Parts
  parts: Parts
  onChange: (part: keyof Parts, value: string) => void
  optional?: boolean
  placeholder?: boolean
}) {
  const id = `${idPrefix}-${part}`
  return (
    <span className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {PART_LABELS[part]}
        {optional ? " (optional)" : ""}
      </Label>
      <Input
        id={id}
        className="font-mono text-xs"
        value={parts[part]}
        placeholder={placeholder ? PART_PLACEHOLDERS[part] : undefined}
        onChange={(e) => onChange(part, e.target.value)}
      />
    </span>
  )
}

/**
 * Pick an object and one of its type's declared relations, and open the
 * relation walk from it.
 *
 * The types and their relations come from the schema graph, which is one read
 * of every type. Two types can share a name in different namespaces, and a
 * tuple names its object type by name alone, so a type's relations are the
 * union over every type of that name. The reads wait for the form to be
 * opened, so the page does not make them for operators who never use it.
 */
function GraphPicker() {
  const graph = useQuery<ResourceTypeGraph>("resourceTypes.graph")
  const namespaces = useQuery<NamespacesResponse>("namespaces.list")
  const [objectType, setObjectType] = useState("")
  const [objectId, setObjectId] = useState("")
  const [relation, setRelation] = useState("")
  const [namespace, setNamespace] = useState("")

  const nodes = graph.data?.nodes ?? []
  const typeNames = [...new Set(nodes.map((n) => n.name))].sort()
  const relations = [
    ...new Set(
      nodes
        .filter((n) => n.name === objectType)
        .flatMap((n) => n.relations.map((r) => r.name))
    ),
  ]
  const nsOptions = namespaceOptions(namespaces.data?.namespaces ?? [""]).filter(
    (o) => o.value !== "all"
  )
  const complete = objectType !== "" && objectId.trim() !== "" && relation !== ""

  return (
    <div className="mt-3 flex flex-col gap-3">
      {graph.data?.truncated && (
        <p className="text-sm text-muted-foreground">
          Showing the first 500 resource types.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <span className="flex flex-col gap-1.5">
          <Label htmlFor="graph-object-type">Object type</Label>
          <NativeSelect
            id="graph-object-type"
            value={objectType}
            onChange={(e) => {
              setObjectType(e.target.value)
              // A relation is one this type declares, so a new type clears it.
              setRelation("")
            }}
          >
            <NativeSelectOption value="">Choose a type</NativeSelectOption>
            {typeNames.map((name) => (
              <NativeSelectOption key={name} value={name}>
                {name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </span>
        <span className="flex flex-col gap-1.5">
          <Label htmlFor="graph-object-id">Object id</Label>
          <Input
            id="graph-object-id"
            className="font-mono text-xs"
            placeholder="readme"
            value={objectId}
            onChange={(e) => setObjectId(e.target.value)}
          />
        </span>
        <span className="flex flex-col gap-1.5">
          <Label htmlFor="graph-relation">Relation</Label>
          <NativeSelect
            id="graph-relation"
            value={relation}
            disabled={objectType === ""}
            onChange={(e) => setRelation(e.target.value)}
          >
            <NativeSelectOption value="">Choose a relation</NativeSelectOption>
            {relations.map((name) => (
              <NativeSelectOption key={name} value={name}>
                {name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </span>
        <span className="flex flex-col gap-1.5">
          <Label htmlFor="graph-namespace">Namespace</Label>
          <NativeSelect
            id="graph-namespace"
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
          >
            {nsOptions.map((o) => (
              <NativeSelectOption key={o.value} value={o.value}>
                {o.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </span>
      </div>
      <div>
        {complete ? (
          <PluginLink
            to={relationGraphPath({
              objectType,
              objectId: objectId.trim(),
              relation,
              namespace,
            })}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Show graph
          </PluginLink>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Show graph
          </Button>
        )}
      </div>
    </div>
  )
}

export function WardenRelationsPage() {
  // One-based, matching ResourceTable's PaginationState.
  const [page, setPage] = useState(1)
  const namespace = useNamespaceFilter(() => setPage(1))
  const [filters, setFilters] = useState<Parts>(EMPTY_PARTS)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<Parts>(EMPTY_PARTS)
  const [deleting, setDeleting] = useState<RelationSummary | null>(null)
  const [pickingGraph, setPickingGraph] = useState(false)

  // Trimmed and dropped when empty: the server treats "" and absent the same
  // way today, but an absent field is the honest way to say "no filter".
  const active = presentParts(filters)

  const list = useQuery<RelationsList>("relations.list", {
    ...namespace.param,
    ...active,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  })
  const create = useCommand<AckResponse>("relations.create")
  const remove = useCommand<AckResponse>("relations.delete")

  const createNamespace = namespace.value === "all" ? "" : namespace.value
  const formPresent = presentParts(form)
  const missing = REQUIRED_PARTS.some((part) => !formPresent[part])

  function setFilter(part: keyof Parts, value: string) {
    setFilters((f) => ({ ...f, [part]: value }))
    // A different filter is a different result set. A page number carried
    // across it lands on page N of a shorter set: an empty table under a
    // caption that still counts rows.
    setPage(1)
  }

  function openCreate() {
    // Reset at open, not at close: the operator is about to read whatever
    // this dialog shows, so a failure from an earlier attempt must not greet
    // them, and a half-typed tuple from then must not either.
    create.reset()
    setForm(EMPTY_PARTS)
    setCreating(true)
  }

  async function confirmCreate() {
    if (missing) return
    // subjectRelation is ABSENT when unset, not an empty string: an empty one
    // is a different tuple from a plain subject to anything that compares.
    const result = await create.execute({
      namespacePath: createNamespace,
      ...formPresent,
    })
    // execute resolves undefined only when the client throws, so this is the
    // success check. A refused create, a duplicate tuple above all, must leave
    // the dialog open with what the operator typed.
    if (result === undefined) return
    setCreating(false)
  }

  async function confirmDelete() {
    if (!deleting) return
    const result = await remove.execute({ id: deleting.id })
    if (result === undefined) return
    setDeleting(null)
    // Deleting the only row on the last page leaves that page past the end
    // of the set. Step back one so the operator lands on rows that exist.
    if (page > 1 && (list.data?.items?.length ?? 0) <= 1) setPage(page - 1)
  }

  const columns: Column<RelationSummary>[] = [
    {
      id: "tuple",
      header: "Tuple",
      // The whole string in one cell, because it is a raw value somebody
      // copies into a check or a DSL file. Six columns would make them
      // reassemble it. The parts stay separate as filters, where narrowing
      // on whichever end you know is the point.
      cell: (r) => tupleString(r),
      className: "font-mono text-xs font-medium",
    },
    {
      id: "namespace",
      header: "Namespace",
      cell: (r) => <NamespaceCell path={r.namespacePath} />,
    },
    {
      id: "createdBy",
      header: "Created by",
      cell: (r) =>
        r.createdBy ? (
          <span className="font-mono text-xs">{r.createdBy}</span>
        ) : (
          <NoneCell label="creator" />
        ),
    },
    {
      id: "createdAt",
      header: "Created",
      cell: (r) => <Timestamp value={r.createdAt} label="creation time" />,
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Relations"
        actions={<Button onClick={openCreate}>New relation</Button>}
      />

      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        <p>
          A relation tuple reads object#relation@subject. Tuples cannot be
          edited, only created and deleted, because the store has no update. To
          change one, delete it and write another.
        </p>
        {/* Tuples cascade at check time: every tuple lookup a check makes
            gets AncestorNamespaces(checkNamespace), in the direct check, the
            expression evaluator and the graph walker (warden engine.go
            evaluateReBAC, TestReBAC_NamespaceCascade). The list filter is an
            exact match, so the listing under a namespace leaves out tuples
            that are in scope there. Both halves have to be said. */}
        <p>
          A tuple is in scope for checks in its own namespace and in every
          namespace below it, the same way roles and policies are. Filtering
          by namespace shows only the tuples stored in exactly that namespace,
          so tuples stored in a parent namespace are not listed under it,
          although they are in scope there too.
        </p>
      </div>

      <details onToggle={(e) => setPickingGraph(e.currentTarget.open)}>
        <summary className="cursor-pointer text-sm font-medium">
          Draw a relation graph
        </summary>
        {pickingGraph && <GraphPicker />}
      </details>

      <FilterBar filters={[namespace.filterConfig]} />

      <div
        role="group"
        aria-label="Filter by tuple part"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6"
      >
        {(Object.keys(EMPTY_PARTS) as (keyof Parts)[]).map((part) => (
          <PartInput
            key={part}
            idPrefix="relation-filter"
            part={part}
            parts={filters}
            onChange={setFilter}
          />
        ))}
      </div>

      <QueryBoundary title="Relations" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.items ?? []
          // The server's total, never rows.length: rows is one page.
          const caption = `${data.total} ${data.total === 1 ? "relation" : "relations"}`
          return (
            <ResourceTable<RelationSummary>
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              caption={caption}
              emptyMessage={emptyListMessage(
                "relations",
                filterPattern(filters),
                namespace.value
              )}
              pagination={{ page, pageSize: data.limit, total: data.total }}
              onPageChange={setPage}
              rowActions={(r) => (
                <>
                  <PluginLink
                    to={relationGraphPath({
                      objectType: r.objectType,
                      objectId: r.objectId,
                      relation: r.relation,
                      namespace: r.namespacePath,
                    })}
                    aria-label={`Graph ${r.objectType}:${r.objectId}#${r.relation}`}
                    className="text-sm underline underline-offset-4"
                  >
                    Graph
                  </PluginLink>
                  <Button
                    variant="destructive"
                    size="sm"
                    aria-label={`Delete ${tupleString(r)}`}
                    onClick={() => {
                      remove.reset()
                      setDeleting(r)
                    }}
                  >
                    Delete
                  </Button>
                </>
              )}
            />
          )
        }}
      </QueryBoundary>

      {/* Both errors live inside their dialog. Base UI marks everything
          outside an open dialog inert and aria-hidden, so an alert on the
          page body is unreachable while the dialog that can fail is open. */}
      <ConfirmDialog
        open={creating}
        onOpenChange={(open) => !open && setCreating(false)}
        title="New relation"
        destructive={false}
        confirmLabel="Create relation"
        pending={create.loading}
        confirmDisabled={missing}
        onConfirm={() => void confirmCreate()}
        description={
          <span className="flex flex-col gap-3">
            <span>
              Writing a tuple in{" "}
              {createNamespace === "" ? "the tenant root" : createNamespace}. It
              is in scope for checks there and in every namespace below it. All
              five parts are required. The subject relation is only for a set,
              such as a group&apos;s members.
            </span>
            {REQUIRED_PARTS.map((part) => (
              <PartInput
                key={part}
                idPrefix="relation"
                part={part}
                parts={form}
                placeholder
                onChange={(p, value) => setForm((f) => ({ ...f, [p]: value }))}
              />
            ))}
            <PartInput
              idPrefix="relation"
              part="subjectRelation"
              parts={form}
              placeholder
              optional
              onChange={(p, value) => setForm((f) => ({ ...f, [p]: value }))}
            />
            <span>
              Writes:{" "}
              {missing ? (
                <span className="text-muted-foreground">
                  fill in the five parts
                </span>
              ) : (
                <span className="font-mono text-xs">
                  {tupleString({
                    objectType: formPresent.objectType ?? "",
                    objectId: formPresent.objectId ?? "",
                    relation: formPresent.relation ?? "",
                    subjectType: formPresent.subjectType ?? "",
                    subjectId: formPresent.subjectId ?? "",
                    subjectRelation: formPresent.subjectRelation,
                  })}
                </span>
              )}
            </span>
            <CommandAlert error={create.error} title="Could not create the relation" />
          </span>
        }
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? `Delete ${tupleString(deleting)}?` : "Delete relation?"}
        description={
          <span className="flex flex-col gap-2">
            <span>
              Access that depends on this tuple stops. Writing the same tuple
              again restores it.
            </span>
            <CommandAlert error={remove.error} title="Could not delete" />
          </span>
        }
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  )
}
