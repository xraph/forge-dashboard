import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { Stat, StatGrid } from "../src/components/stat-grid"

const cell = (label: string) =>
  screen.getByText(label).closest("[data-slot=stat]") as HTMLElement
const value = (label: string) =>
  cell(label).querySelector("[data-slot=stat-value]") as HTMLElement
const grid = () =>
  document.querySelector("[data-slot=stat-grid] > div") as HTMLElement

describe("StatGrid", () => {
  it("renders one cell per item, label and value both visible", () => {
    render(
      <StatGrid
        items={[
          { label: "Connections", value: 12 },
          { label: "Rooms", value: 3 },
        ]}
      />
    )
    expect(value("Connections").textContent).toBe("12")
    expect(value("Rooms").textContent).toBe("3")
  })

  it("draws nothing for an empty list, not a framed sliver", () => {
    const { container } = render(<StatGrid items={[]} />)
    expect(container.querySelector("[data-slot=stat-grid]")).toBeNull()
    expect(container.innerHTML).toBe("")
  })

  it("renders a zero rather than treating it as missing", () => {
    render(<StatGrid items={[{ label: "Rooms", value: 0 }]} />)
    expect(value("Rooms").textContent).toBe("0")
  })

  it("renders a hint when given one", () => {
    render(
      <StatGrid
        items={[{ label: "Uptime", value: "3h 2m", hint: "since restart" }]}
      />
    )
    expect(cell("Uptime").textContent).toContain("since restart")
  })

  it("is one panel, named when given a label", () => {
    render(
      <StatGrid
        aria-label="Instance counters"
        items={[{ label: "Rooms", value: 3 }]}
      />
    )
    expect(
      screen.getByRole("group", { name: "Instance counters" })
    ).toBeTruthy()
  })

  it("marks an untoned cell as default and adds no emphasis", () => {
    render(<StatGrid items={[{ label: "Rooms", value: 3 }]} />)
    expect(cell("Rooms").getAttribute("data-tone")).toBe("default")
    expect(cell("Rooms").className).not.toMatch(
      /bg-(destructive|warning|success)/
    )
    expect(value("Rooms").className).not.toMatch(
      /text-(destructive|warning|success)/
    )
  })

  it.each([
    ["danger", "bg-destructive/5", "text-destructive"],
    ["warning", "bg-warning/10", "text-warning-foreground"],
    ["success", "bg-success/10", "text-success-foreground"],
  ] as const)(
    "a %s tone sets the attribute, a cell tint and the value colour",
    (tone, tint, text) => {
      render(
        <StatGrid
          items={[
            { label: "Quiet", value: 1 },
            { label: "Loud", value: 2, tone },
          ]}
        />
      )
      expect(cell("Loud").getAttribute("data-tone")).toBe(tone)
      expect(cell("Loud").className).toContain(tint)
      expect(cell("Loud").className).not.toMatch(/ring-/)
      expect(value("Loud").className).toContain(text)
      expect(cell("Quiet").getAttribute("data-tone")).toBe("default")
      expect(cell("Quiet").className).not.toContain(tint)
    }
  )

  // Five across only when the rows come out even.
  it.each([5, 10, 15])("uses five columns for %i items", (n) => {
    render(
      <StatGrid
        items={Array.from({ length: n }, (_, i) => ({
          label: `S${i}`,
          value: i,
        }))}
      />
    )
    expect(grid().className).toContain("@5xl/main:grid-cols-5")
  })

  const gridOf = (n: number) => {
    render(
      <StatGrid
        items={Array.from({ length: n }, (_, i) => ({
          label: `S${i}`,
          value: i,
        }))}
      />
    )
    return grid().className.split(/\s+/)
  }

  // Pick the count that fills every row: n up to four, then 5, 4, 3 divide it.
  it.each([
    [1, "@2xl/main:grid-cols-1"],
    [2, "@2xl/main:grid-cols-2"],
    [3, "@2xl/main:grid-cols-3"],
    [4, "@2xl/main:grid-cols-4"],
    [6, "@2xl/main:grid-cols-3"],
    [7, "@2xl/main:grid-cols-4"],
    [8, "@2xl/main:grid-cols-4"],
    [9, "@2xl/main:grid-cols-3"],
    [10, "@2xl/main:grid-cols-4"],
  ])("lays %i items out with %s", (n, expected) => {
    const cls = gridOf(n)
    expect(cls).toContain(expected)
    // Only one wide-container column count at a time.
    expect(
      cls.filter((c) => c.startsWith("@2xl/main:grid-cols-"))
    ).toHaveLength(1)
  })

  it("keeps a single item on one column at every width", () => {
    const cls = gridOf(1)
    expect(cls).toContain("grid-cols-1")
    expect(cls).not.toContain("grid-cols-2")
  })

  it.each([2, 3, 4, 6])("keeps two columns when narrow for %i items", (n) => {
    expect(gridOf(n)).toContain("grid-cols-2")
  })

  it("goes to five columns only past @5xl, for multiples of five", () => {
    expect(gridOf(10)).toContain("@5xl/main:grid-cols-5")
  })

  it.each([1, 3, 4, 6, 7, 8, 9])("adds no five-column step for %i", (n) => {
    expect(gridOf(n).some((c) => c.startsWith("@5xl/main:"))).toBe(false)
  })

  it("wraps a linked cell with renderLink, and leaves it plain without one", () => {
    const { rerender } = render(
      <StatGrid
        items={[{ label: "Failed", value: 2, href: "/jobs?state=failed" }]}
      />
    )
    expect(cell("Failed").closest("a")).toBeNull()
    rerender(
      <StatGrid
        items={[{ label: "Failed", value: 2, href: "/jobs?state=failed" }]}
        renderLink={(href, c) => <a href={href}>{c}</a>}
      />
    )
    const link = cell("Failed").closest("a")
    expect(link?.getAttribute("href")).toBe("/jobs?state=failed")
    expect(link?.querySelector("[data-slot=stat-value]")?.textContent).toBe("2")
  })

  it("only links the items that carry an href", () => {
    render(
      <StatGrid
        items={[
          { label: "Failed", value: 2, href: "/jobs?state=failed" },
          { label: "Queued", value: 5 },
        ]}
        renderLink={(href, c) => <a href={href}>{c}</a>}
      />
    )
    expect(cell("Failed").closest("a")).toBeTruthy()
    expect(cell("Queued").closest("a")).toBeNull()
  })
})

// The standalone Stat stays a card: dispatch places it inside links.
describe("Stat", () => {
  it("stays a card on its own", () => {
    render(<Stat label="failed" value={2} tone="danger" />)
    const card = screen.getByText("failed").closest("[data-slot=card]")
    expect(card?.getAttribute("data-tone")).toBe("danger")
    expect(card?.className).toContain("ring-destructive/50")
  })
})
