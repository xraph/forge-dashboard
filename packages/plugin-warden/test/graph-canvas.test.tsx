import "./flow-env"
import { describe, expect, it } from "vitest"
import { layoutGraph } from "../src/components/graph-canvas"

const SIZE = { width: 200, height: 80 }

describe("layoutGraph", () => {
  it("ranks a source above its target, top to bottom", () => {
    const layout = layoutGraph(
      [
        { id: "a", ...SIZE },
        { id: "b", ...SIZE },
        { id: "c", ...SIZE },
      ],
      [
        { id: "ab", source: "a", target: "b", label: "viewer" },
        { id: "bc", source: "b", target: "c", label: "member" },
      ]
    )
    const y = (id: string) => layout.positions.get(id)!.y
    expect(y("a")).toBeLessThan(y("b"))
    expect(y("b")).toBeLessThan(y("c"))
  })

  it("gives parallel edges between the same two nodes their own label positions", () => {
    const layout = layoutGraph(
      [
        { id: "a", ...SIZE },
        { id: "b", ...SIZE },
      ],
      [
        { id: "viewer", source: "a", target: "b", label: "viewer #member" },
        { id: "editor", source: "a", target: "b", label: "editor #member" },
      ]
    )
    const v = layout.routes.get("viewer")!
    const e = layout.routes.get("editor")!
    expect(`${v.labelX},${v.labelY}`).not.toBe(`${e.labelX},${e.labelY}`)
  })

  it("lays out a type that points at itself", () => {
    const layout = layoutGraph(
      [{ id: "a", ...SIZE }],
      [{ id: "loop", source: "a", target: "a", label: "member" }]
    )
    expect(layout.routes.get("loop")!.points.length).toBeGreaterThan(1)
  })

  it("keeps nodes from overlapping", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => ({ id, ...SIZE }))
    const layout = layoutGraph(nodes, [
      { id: "ab", source: "a", target: "b" },
      { id: "ac", source: "a", target: "c" },
      { id: "ad", source: "a", target: "d" },
    ])
    const xs = ["b", "c", "d"]
      .map((id) => layout.positions.get(id)!.x)
      .sort((p, q) => p - q)
    expect(xs[1]! - xs[0]!).toBeGreaterThanOrEqual(SIZE.width)
    expect(xs[2]! - xs[1]!).toBeGreaterThanOrEqual(SIZE.width)
  })
})
