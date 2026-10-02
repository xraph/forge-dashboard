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
const MUTED_HEIGHT = 56
// A type with dozens of permissions would make a card taller than the canvas.
// The rest are on its own page, one click away.
const SHOWN_PERMISSIONS = 6

const UNDECLARED = "undeclared:"

function namespaceLabel(path: string): string {
  return path === "" ? "the tenant root" : path
}

function TypeCard({ node }: { node: ResourceTypeGraphNode }) {
  const shown = node.permissions.slice(0, SHOWN_PERMISSIONS)
  const hidden = node.permissions.length - shown.length
  return (
    <PluginLink
      to={`/resource-types/${node.id}`}
      aria-label={`Open ${node.name} in ${namespaceLabel(node.namespacePath)}`}
      className="flex h-full flex-col gap-1 p-3 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
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
    </PluginLink>
  )
}

function UndeclaredCard({ name }: { name: string }) {
  return (
    <div
      data-undeclared="true"
      className="flex h-full flex-col justify-center gap-0.5 p-3"
    >
      <span className="truncate font-mono text-xs">{name}</span>
      <span className="text-xs">not a resource type</span>
    </div>
  )
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
} {
  const nodes: CanvasNode[] = graph.nodes.map((n) => {
    const shown = Math.min(n.permissions.length, SHOWN_PERMISSIONS)
    const more = n.permissions.length > shown ? 1 : 0
    return {
      id: n.id,
      width: NODE_WIDTH,
      height: HEADER_HEIGHT + (shown + more) * ROW_HEIGHT,
      content: <TypeCard node={n} />,
    }
  })
  const known = new Set(graph.nodes.map((n) => n.id))

  const undeclared = new Set<string>()
  const edges: CanvasEdge[] = []
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
  return { nodes, edges }
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
    <div className="flex flex-col gap-2">
      {graph.truncated && (
        <p className="text-sm text-muted-foreground">
          Showing the first 500 resource types.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Each box is a resource type. An arrow runs from a type to a subject one
        of its relations allows, and is labelled with that relation.
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
