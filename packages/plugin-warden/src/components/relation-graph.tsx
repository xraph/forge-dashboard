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
  /**
   * The node cap removed some of this node's edges. Tells a set the walk went
   * through, whose edges were then cut, from one it never walked.
   */
  capped: boolean
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
 * not as unexpanded. A subject set with `walked` false has not all its tuples
 * drawn, for one of two reasons that the server tells apart with `capped`: the
 * walk went through it and the node cap then cut its edges ("not fully drawn",
 * whether some of them are on the canvas or none), or the walk never went
 * through it, as at a stop ("not expanded"). The drawn edges cannot say which:
 * a set whose children all fell past the cap has none, like one never walked.
 */
function marks(node: RelationExpandNode): string[] {
  const out: string[] = []
  if (node.depth === 0) out.push("root")
  if (!node.relation) out.push("subject")
  else if (!node.walked)
    out.push(node.capped ? "not fully drawn" : "not expanded")
  return out
}

function NodeCard({ node }: { node: RelationExpandNode }) {
  return (
    <div className="flex h-full min-w-0 flex-col justify-center gap-1 p-3">
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
  const pathPairs = new Set<string>()
  for (let i = 0; i + 1 < expansion.path.length; i++) {
    pathPairs.add(`${expansion.path[i]}\n${expansion.path[i + 1]}`)
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
  // The path is node keys with no namespace, so when one pair has tuples in
  // two namespaces it does not say which the walk took. The walk reports an
  // edge in the order it saw the tuples, and the first edge into a node is the
  // one that reached it, so the first edge of the pair, in the response's
  // order, is the one that is lit.
  const lit = new Set<string>()
  for (const e of expansion.edges) {
    if (!known.has(e.from) || !known.has(e.to)) continue
    const id = `${e.from}|${e.to}|${e.namespacePath}`
    if (seen.has(id)) continue
    seen.add(id)
    const pair = `${e.from}\n${e.to}`
    const onPathPair = pathPairs.has(pair) && !lit.has(pair)
    if (onPathPair) lit.add(pair)
    edges.push({
      id,
      source: e.from,
      target: e.to,
      label: e.namespacePath === "" ? undefined : e.namespacePath,
      highlighted: onPathPair,
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
    <div className="flex min-w-0 flex-col gap-2">
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
