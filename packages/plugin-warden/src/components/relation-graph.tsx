import { lazy, Suspense, useMemo } from "react"
import { Skeleton } from "@forge-go/dashboard-kit/components/skeleton"
import type { CanvasEdge, CanvasNode } from "./graph-canvas"

// React Flow and dagre load when a graph is first drawn, as for the schema
// graph. This module may be imported by anything: it holds no static import
// of the canvas.
const GraphCanvas = lazy(() => import("./graph-canvas"))

/** Mirrors the Go `RelationExpandNode`. */
export interface RelationExpandNode {
  /** `type:id#relation` for a subject set, `type:id` for a single subject. */
  key: string
  type: string
  id: string
  relation?: string
  depth: number
  /**
   * Every one of the node's tuples is drawn. False for a subject set that was
   * reached and not expanded, and for every single subject, which is a leaf.
   */
  walked: boolean
}

/** Mirrors the Go `RelationExpandEdge`: one tuple, between node keys. */
export interface RelationExpandEdge {
  from: string
  to: string
  namespacePath: string
}

/** Why the walk ended: the Go `ExpandStop`. */
export type RelationExpandStop = "complete" | "depth" | "visited" | "fanout"

/** Mirrors the Go `RelationExpandResponse`. */
export interface RelationExpansion {
  nodes: RelationExpandNode[]
  edges: RelationExpandEdge[]
  stop: RelationExpandStop
  /** The limit that stopped the walk, 0 when it completed. */
  limit: number
  /** False when a check may walk with a walker other than the built-in one. */
  exactWalk: boolean
  /** Nodes reached and left out past the cap. */
  truncatedNodes: number
  /** Node keys, root first, to the subject asked for. Empty when not reached. */
  path: string[]
}

const NODE_WIDTH = 256
const NODE_HEIGHT = 64

/**
 * What a node says about itself besides its key. The root is marked. A single
 * subject is a leaf the walk never expands, so it is marked as a subject and
 * not as unexpanded. A subject set that was not walked is the one that is
 * "not expanded": reached, with its own tuples not all drawn.
 */
function marks(node: RelationExpandNode): string[] {
  const out: string[] = []
  if (node.depth === 0) out.push("root")
  if (!node.relation) out.push("subject")
  else if (!node.walked) out.push("not expanded")
  return out
}

function NodeCard({ node }: { node: RelationExpandNode }) {
  return (
    <div className="flex h-full flex-col justify-center gap-1 p-3">
      <span className="truncate font-mono text-xs" title={node.key}>
        {node.key}
      </span>
      <span className="flex gap-2 text-xs text-muted-foreground">
        {marks(node).map((m) => (
          <span key={m}>{m}</span>
        ))}
      </span>
    </div>
  )
}

/**
 * The canvas's nodes and edges for an expansion, and the same edges as text.
 *
 * Nodes are joined by key. The path, when there is one, lights its nodes and
 * the edges between consecutive keys. An edge is labelled only with the
 * namespace its tuple is stored in, and only when that is not the root: the
 * relation is already in the key of the node it leaves.
 */
export function buildRelationGraph(expansion: RelationExpansion): {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  descriptions: string[]
} {
  const onPath = new Set(expansion.path)
  const pathEdges = new Set<string>()
  for (let i = 0; i + 1 < expansion.path.length; i++) {
    pathEdges.add(`${expansion.path[i]}\n${expansion.path[i + 1]}`)
  }
  const known = new Set(expansion.nodes.map((n) => n.key))

  const nodes: CanvasNode[] = expansion.nodes.map((n) => ({
    id: n.key,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    content: <NodeCard node={n} />,
    highlighted: onPath.has(n.key),
  }))
  const edges: CanvasEdge[] = []
  const descriptions: string[] = []
  const seen = new Set<string>()
  for (const e of expansion.edges) {
    if (!known.has(e.from) || !known.has(e.to)) continue
    const id = `${e.from}|${e.to}|${e.namespacePath}`
    if (seen.has(id)) continue
    seen.add(id)
    edges.push({
      id,
      source: e.from,
      target: e.to,
      label: e.namespacePath === "" ? undefined : e.namespacePath,
      highlighted: pathEdges.has(`${e.from}\n${e.to}`),
    })
    descriptions.push(
      `${e.from} includes ${e.to}${e.namespacePath === "" ? "" : ` (${e.namespacePath})`}`
    )
  }
  return { nodes, edges, descriptions }
}

/**
 * An expansion drawn, with every edge again as text under it. The picture has
 * no text alternative of its own.
 */
export function RelationGraph({ expansion }: { expansion: RelationExpansion }) {
  const built = useMemo(() => buildRelationGraph(expansion), [expansion])
  return (
    <div className="flex flex-col gap-2">
      <Suspense
        fallback={
          <div
            role="status"
            aria-busy="true"
            aria-label="Loading the relation graph"
          >
            <Skeleton className="h-[34rem] w-full" />
          </div>
        }
      >
        <GraphCanvas
          label="Relation walk"
          nodes={built.nodes}
          edges={built.edges}
        />
      </Suspense>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          Relationships as text
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
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
