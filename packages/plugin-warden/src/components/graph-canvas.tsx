import { useMemo } from "react"
import type { CSSProperties, ReactNode } from "react"
import {
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
} from "@xyflow/react"
import type { Edge, EdgeProps, Node, NodeProps } from "@xyflow/react"
import { Graph, layout } from "@dagrejs/dagre"
import "@xyflow/react/dist/style.css"
import { cn } from "@forge-go/dashboard-kit/lib/utils"

/** A box on the canvas. The size is the caller's: the layout needs it first. */
export interface CanvasNode {
  id: string
  width: number
  height: number
  /** What the box holds. It fills the box, so a link can be the whole card. */
  content?: ReactNode
  /** Drawn dashed and dim: something named but not known. */
  muted?: boolean
}

/** A line between two boxes. Parallel edges between a pair are fine. */
export interface CanvasEdge {
  id: string
  source: string
  target: string
  label?: string
}

interface Point {
  x: number
  y: number
}

/**
 * Where dagre put one edge, and where its label goes.
 *
 * A type alias and not an interface: React Flow's `data` must be assignable to
 * a string-keyed record, which only an alias is.
 */
export type EdgeRoute = {
  points: Point[]
  labelX: number
  labelY: number
}

export interface GraphLayout {
  /** Each node's top-left corner, which is what React Flow positions by. */
  positions: Map<string, Point>
  routes: Map<string, EdgeRoute>
}

const NODE_SEP = 48
const RANK_SEP = 96
const EDGE_SEP = 24
const LABEL_HEIGHT = 20
// Mono text at 12px is about 7px a character, plus the label's padding.
const LABEL_CHAR = 7
const LABEL_PADDING = 14

/**
 * Lays the graph out top to bottom with dagre.
 *
 * Every edge is given its label's size, so dagre reserves room for it and
 * places it on its own: two edges between the same pair of boxes get two
 * label positions instead of one on top of the other. dagre also routes each
 * edge, and the route is kept so the line and its label agree.
 */
export function layoutGraph(
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): GraphLayout {
  const g = new Graph({ multigraph: true })
  g.setGraph({
    rankdir: "TB",
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    edgesep: EDGE_SEP,
  })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height })
  for (const e of edges) {
    g.setEdge(
      e.source,
      e.target,
      {
        labelpos: "c",
        width: e.label ? e.label.length * LABEL_CHAR + LABEL_PADDING : 0,
        height: e.label ? LABEL_HEIGHT : 0,
      },
      e.id
    )
  }
  layout(g)

  const positions = new Map<string, Point>()
  for (const n of nodes) {
    const placed = g.node(n.id) as { x: number; y: number }
    positions.set(n.id, {
      x: placed.x - n.width / 2,
      y: placed.y - n.height / 2,
    })
  }
  const routes = new Map<string, EdgeRoute>()
  for (const e of edges) {
    const placed = g.edge({ v: e.source, w: e.target, name: e.id }) as {
      points: Point[]
      x?: number
      y?: number
    }
    const points = placed.points ?? []
    const middle = points[Math.floor(points.length / 2)]
    routes.set(e.id, {
      points,
      labelX: placed.x ?? middle?.x ?? 0,
      labelY: placed.y ?? middle?.y ?? 0,
    })
  }
  return { positions, routes }
}

/** A smooth line through dagre's points: each interior point bends it. */
function pathThrough(points: Point[]): string {
  const [first, ...rest] = points
  if (!first) return ""
  let d = `M${first.x},${first.y}`
  if (rest.length === 1) return `${d} L${rest[0]!.x},${rest[0]!.y}`
  for (let i = 0; i < rest.length - 1; i++) {
    const control = rest[i]!
    const next = rest[i + 1]!
    const end =
      i === rest.length - 2
        ? next
        : { x: (control.x + next.x) / 2, y: (control.y + next.y) / 2 }
    d += ` Q${control.x},${control.y} ${end.x},${end.y}`
  }
  return d
}

type CardNodeType = Node<{ content?: ReactNode; muted: boolean }, "card">
type RoutedEdgeType = Edge<EdgeRoute & { label?: string }, "routed">

// Hidden: the lines are drawn from dagre's routes. React Flow still wants a
// handle on each end to attach an edge to.
const HANDLE: CSSProperties = { opacity: 0, pointerEvents: "none" }

function CardNode({ data, width, height }: NodeProps<CardNodeType>) {
  return (
    <div
      style={{ width, height }}
      className={cn(
        "overflow-hidden rounded-md border bg-card text-card-foreground shadow-xs",
        data.muted &&
          "border-dashed bg-muted/40 text-muted-foreground shadow-none"
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={HANDLE}
        isConnectable={false}
      />
      {data.content}
      <Handle
        type="source"
        position={Position.Bottom}
        style={HANDLE}
        isConnectable={false}
      />
    </div>
  )
}

function RoutedEdge({
  id,
  source,
  target,
  data,
  markerEnd,
}: EdgeProps<RoutedEdgeType>) {
  return (
    <g data-edge-source={source} data-edge-target={target}>
      <BaseEdge
        id={id}
        path={pathThrough(data?.points ?? [])}
        markerEnd={markerEnd}
      />
      {data?.label ? (
        <EdgeLabelRenderer>
          <span
            data-edge-label-source={source}
            data-edge-label-target={target}
            className="pointer-events-none absolute rounded-sm border bg-background px-1.5 py-0.5 font-mono text-xs text-foreground"
            style={{
              transform: `translate(-50%, -50%) translate(${data.labelX}px, ${data.labelY}px)`,
            }}
          >
            {data.label}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </g>
  )
}

// Declared once, outside the component: React Flow compares these by identity
// and rebuilds every node and edge when the object changes.
const NODE_TYPES = { card: CardNode }
const EDGE_TYPES = { routed: RoutedEdge }

// The canvas takes the kit's tokens, so it follows light and dark with the
// shell. React Flow's own defaults are overridden at the root, where they are
// declared.
const THEME = {
  "--xy-background-color-default": "transparent",
  "--xy-background-pattern-color-default": "var(--border)",
  "--xy-edge-stroke-default": "var(--muted-foreground)",
  "--xy-edge-label-color-default": "var(--foreground)",
  "--xy-edge-label-background-color-default": "var(--background)",
  "--xy-controls-button-background-color-default": "var(--card)",
  "--xy-controls-button-background-color-hover-default": "var(--muted)",
  "--xy-controls-button-color-default": "var(--foreground)",
  "--xy-controls-button-color-hover-default": "var(--foreground)",
  "--xy-controls-button-border-color-default": "var(--border)",
  "--xy-attribution-background-color-default": "transparent",
} as CSSProperties

export interface GraphCanvasProps {
  /** Names the canvas for a screen reader. */
  label: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  className?: string
}

/**
 * A read-only, pannable and zoomable graph: React Flow, laid out with dagre.
 *
 * It draws what it is given and owns nothing else. Each node is a box of the
 * caller's content, so a page decides what a node says and where it leads.
 * Nodes do not drag and cannot be connected: the picture is a view of data,
 * and a rearranged one would be lost on the next read.
 *
 * The default export, and the one place that imports React Flow, so a page
 * reaches it through `lazy(() => import(...))` and nothing of it is in the
 * shell's entry chunk.
 */
export default function GraphCanvas({
  label,
  nodes,
  edges,
  className,
}: GraphCanvasProps) {
  const { flowNodes, flowEdges } = useMemo(() => {
    const { positions, routes } = layoutGraph(nodes, edges)
    const flowNodes: CardNodeType[] = nodes.map((n) => ({
      id: n.id,
      type: "card",
      position: positions.get(n.id)!,
      data: { content: n.content, muted: n.muted ?? false },
      // The size is known, so the node draws before React Flow has measured
      // it, and the handles are placed where they will be.
      width: n.width,
      height: n.height,
      handles: [
        {
          type: "target",
          position: Position.Top,
          x: n.width / 2,
          y: 0,
          width: 1,
          height: 1,
        },
        {
          type: "source",
          position: Position.Bottom,
          x: n.width / 2,
          y: n.height,
          width: 1,
          height: 1,
        },
      ],
      draggable: false,
      connectable: false,
      focusable: false,
    }))
    const flowEdges: RoutedEdgeType[] = edges.map((e) => ({
      id: e.id,
      type: "routed",
      source: e.source,
      target: e.target,
      data: { ...routes.get(e.id)!, label: e.label },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "var(--muted-foreground)",
      },
      focusable: false,
    }))
    return { flowNodes, flowEdges }
  }, [nodes, edges])

  return (
    <div
      className={cn(
        "h-[34rem] w-full overflow-hidden rounded-md border",
        className
      )}
      role="group"
      aria-label={label}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        style={THEME}
        fitView
        minZoom={0.1}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable={false}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
