import { lazy, Suspense, useMemo } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Skeleton } from "@forge-go/dashboard-kit/components/skeleton"
import type { CanvasEdge, CanvasNode } from "./graph-canvas"
import { emptyListMessage } from "./namespace-filter"
import type { NamespaceValue } from "./namespace-filter"

// React Flow and dagre are a large part of the page's weight and nothing else
// in the plugin uses them, so they load when a graph is first drawn.
const GraphCanvas = lazy(() => import("./graph-canvas"))

/** Mirrors the Go `RelationDefDTO`. */
export interface GraphRelationDef {
  name: string
  allowedSubjects: string[]
}

/** Mirrors the Go `PermissionDefDTO`. */
export interface GraphPermissionDef {
  name: string
  expression: string
}

/** Mirrors the Go `ResourceTypeGraphNode`: one type with its definitions. */
export interface ResourceTypeGraphNode {
  id: string
  namespacePath: string
  name: string
  relations: GraphRelationDef[]
  permissions: GraphPermissionDef[]
}

/**
 * Mirrors the Go `ResourceTypeGraphEdge`: one allowed subject of one relation.
 *
 * `fromId` and `toIds` are what to join on. Two types can share a name in
 * different namespaces, so `from` and `to` alone cannot say which is meant.
 */
export interface ResourceTypeGraphEdge {
  from: string
  fromId: string
  relation: string
  to: string
  /** The subject set's relation for "type#rel", else absent. */
  toRelation?: string
  declared: boolean
  /** The id of every returned type named `to`. Empty when undeclared. */
  toIds: string[]
}

/** Mirrors the Go `ResourceTypeGraphResponse`. */
export interface ResourceTypeGraph {
  nodes: ResourceTypeGraphNode[]
  edges: ResourceTypeGraphEdge[]
  /** More than 500 types exist, and only the first 500 are here. */
  truncated: boolean
}

const NODE_WIDTH = 256
const HEADER_HEIGHT = 52
const ROW_HEIGHT = 18
// Two lines of text-xs (16px each, 2px apart) and 12px of padding either side.
const MUTED_HEIGHT = 64
// A type with dozens of permissions would make a card taller than the canvas.
// The rest are on its own page, one click away.
const SHOWN_PERMISSIONS = 6

const UNDECLARED = "undeclared:"

/**
 * The relations that list no subject types. An empty list puts no limit on
 * the subject type, so such a relation has no arrow to draw: its card names
 * it instead, and so does the text list, so it never reads as allowing
 * nothing.
 */
function openRelations(node: ResourceTypeGraphNode): string[] {
  return (node.relations ?? [])
    .filter((r) => (r.allowedSubjects ?? []).length === 0)
    .map((r) => r.name)
}

function namespaceLabel(path: string): string {
  return path === "" ? "the tenant root" : path
}

function TypeCard({ node }: { node: ResourceTypeGraphNode }) {
  const shown = node.permissions.slice(0, SHOWN_PERMISSIONS)
  const hidden = node.permissions.length - shown.length
  const open = openRelations(node)
  return (
    <PluginLink
      to={`/resource-types/${node.id}`}
      aria-label={`Open ${node.name} in ${namespaceLabel(node.namespacePath)}`}
      className="flex h-full min-w-0 flex-col gap-1 p-3 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium">{node.name}</span>
        <span
          className="shrink-0 font-mono text-xs text-muted-foreground"
          title={node.namespacePath === "" ? "Tenant root" : node.namespacePath}
        >
          {node.namespacePath === "" ? "/" : node.namespacePath}
        </span>
      </span>
      {shown.map((p) => (
        <span
          key={p.name}
          className="truncate font-mono text-xs text-muted-foreground"
          title={`${p.name} = ${p.expression}`}
        >
          {`${p.name} = ${p.expression}`}
        </span>
      ))}
      {hidden > 0 && (
        <span className="text-xs text-muted-foreground">{`and ${hidden} more`}</span>
      )}
      {open.map((name) => (
        <span
          key={`open:${name}`}
          data-open-relation={name}
          className="truncate font-mono text-xs text-muted-foreground"
          title={`${name}: any subject type`}
        >
          {`${name}: any subject type`}
        </span>
      ))}
    </PluginLink>
  )
}

function UndeclaredCard({ name }: { name: string }) {
  return (
    <div
      data-undeclared="true"
      className="flex h-full min-w-0 flex-col justify-center gap-0.5 p-3"
    >
      <span className="truncate font-mono text-xs">{name}</span>
      <span className="text-xs">not a resource type in this view</span>
    </div>
  )
}

/** A type's name, with its namespace in parentheses unless it is the root. */
function typeName(name: string, namespacePath: string, suffix = ""): string {
  return namespacePath === ""
    ? `${name}${suffix}`
    : `${name}${suffix} (${namespacePath})`
}

/**
 * One edge as a sentence a screen reader can read: "document viewer
 * group#member", with the namespace of either end after it when that end is
 * not at the root, as in "document viewer group#member (eng/platform)". A
 * target that is no type in the view has no namespace to give.
 */
function describeEdge(
  from: ResourceTypeGraphNode,
  edge: ResourceTypeGraphEdge,
  to: ResourceTypeGraphNode | null
): string {
  const suffix = edge.toRelation ? `#${edge.toRelation}` : ""
  return [
    typeName(from.name, from.namespacePath),
    edge.relation,
    to ? typeName(to.name, to.namespacePath, suffix) : `${edge.to}${suffix}`,
  ].join(" ")
}

/**
 * The canvas's nodes and edges for a schema graph.
 *
 * Every edge is joined to its nodes by id: `fromId` for the type that owns the
 * relation, and each of `toIds` for the types it allows. An edge whose target
 * names two types draws to both. An edge whose target names none ends at one
 * muted node for that name, shared by every edge to it.
 */
export function buildSchemaGraph(graph: ResourceTypeGraph): {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  /** One line per drawn edge, in the order drawn: the graph as text. */
  descriptions: string[]
} {
  const nodes: CanvasNode[] = graph.nodes.map((n) => {
    const shown = Math.min(n.permissions.length, SHOWN_PERMISSIONS)
    const more = n.permissions.length > shown ? 1 : 0
    const open = openRelations(n).length
    return {
      id: n.id,
      width: NODE_WIDTH,
      height: HEADER_HEIGHT + (shown + more + open) * ROW_HEIGHT,
      content: <TypeCard node={n} />,
    }
  })
  const known = new Set(graph.nodes.map((n) => n.id))
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))

  const undeclared = new Set<string>()
  const edges: CanvasEdge[] = []
  const descriptions: string[] = []
  const seen = new Set<string>()
  for (const e of graph.edges) {
    if (!known.has(e.fromId)) continue
    const label = e.toRelation ? `${e.relation} #${e.toRelation}` : e.relation
    const targets =
      e.toIds.length > 0
        ? e.toIds.filter((id) => known.has(id))
        : [UNDECLARED + e.to]
    for (const target of targets) {
      if (target.startsWith(UNDECLARED)) undeclared.add(e.to)
      const id = `${e.fromId}|${e.relation}|${e.to}#${e.toRelation ?? ""}|${target}`
      if (seen.has(id)) continue
      seen.add(id)
      edges.push({ id, source: e.fromId, target, label })
      descriptions.push(
        describeEdge(byId.get(e.fromId)!, e, byId.get(target) ?? null)
      )
    }
  }
  // A relation that lists no subject types has no edge, so it gets its own
  // line after the drawn edges: "document watcher any subject type".
  for (const n of graph.nodes) {
    for (const name of openRelations(n)) {
      descriptions.push(
        `${typeName(n.name, n.namespacePath)} ${name} any subject type`
      )
    }
  }
  for (const name of undeclared) {
    nodes.push({
      id: UNDECLARED + name,
      width: NODE_WIDTH,
      height: MUTED_HEIGHT,
      muted: true,
      content: <UndeclaredCard name={name} />,
    })
  }
  return { nodes, edges, descriptions }
}

function SchemaGraphView({
  graph,
  namespace,
}: {
  graph: ResourceTypeGraph
  namespace: NamespaceValue
}) {
  const built = useMemo(() => buildSchemaGraph(graph), [graph])
  if (graph.nodes.length === 0) {
    return (
      <EmptyState title={emptyListMessage("resource types", "", namespace)} />
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {graph.truncated && (
        <p className="text-sm text-muted-foreground">
          Showing the first 500 resource types.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Each solid box is a resource type. A dashed box is a name the relations
        allow that no resource type in this view has: a subject kind such as
        user, or a type outside this namespace or past the first 500. An arrow
        runs from a type to a subject one of its relations allows, and is
        labelled with that relation. A relation that lists no subject types
        allows any subject: it has no arrow, and its type&apos;s box names it.
      </p>
      <Suspense
        fallback={
          <div
            role="status"
            aria-busy="true"
            aria-label="Loading the schema graph"
          >
            <Skeleton className="h-[34rem] w-full" />
          </div>
        }
      >
        <GraphCanvas
          label="Resource type schema"
          nodes={built.nodes}
          edges={built.edges}
        />
      </Suspense>
      {/* The picture has no text alternative of its own, so every edge is
          here as a line a screen reader can read. */}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          Relationships as text
        </summary>
        <ul className="mt-2 flex min-w-0 flex-col gap-1">
          {built.descriptions.map((d) => (
            <li key={d} className="font-mono text-xs">
              {d}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

/**
 * The tenant's resource types drawn as a graph: what the schema allows, not
 * what is stored. A type is a box that links to its page, and each relation an
 * arrow to the subjects it allows.
 */
export function SchemaGraph({
  namespace,
  param,
}: {
  namespace: NamespaceValue
  param: { namespacePath?: string }
}) {
  const query = useQuery<ResourceTypeGraph>("resourceTypes.graph", param)
  return (
    <QueryBoundary title="Resource type graph" query={query} skeletonRows={5}>
      {(graph) => <SchemaGraphView graph={graph} namespace={namespace} />}
    </QueryBoundary>
  )
}
