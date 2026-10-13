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
    expect(cell("Rooms").className).not.toMatch(/before:bg-/)
    expect(value("Rooms").className).not.toMatch(
      /text-(destructive|warning|success)/
    )
  })

  it.each([
    ["danger", "before:bg-destructive", "text-destructive"],
    ["warning", "before:bg-warning", "text-warning-foreground"],
    ["success", "before:bg-success", "text-success-foreground"],
  ] as const)(
    "a %s tone sets the attribute, a top bar and the value colour",
    (tone, bar, text) => {
      render(
        <StatGrid
          items={[
            { label: "Quiet", value: 1 },
            { label: "Loud", value: 2, tone },
          ]}
        />
      )
      expect(cell("Loud").getAttribute("data-tone")).toBe(tone)
      expect(cell("Loud").className).toContain(bar)
      expect(cell("Loud").className).not.toMatch(/ring-/)
      expect(value("Loud").className).toContain(text)
      expect(cell("Quiet").getAttribute("data-tone")).toBe("default")
      expect(cell("Quiet").className).not.toContain(bar)
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

  it.each([1, 4, 7, 9])("keeps four columns for %i items", (n) => {
    render(
      <StatGrid
        items={Array.from({ length: n }, (_, i) => ({
          label: `S${i}`,
          value: i,
        }))}
      />
    )
    expect(grid().className).not.toContain("grid-cols-5")
    expect(grid().className).toContain("@2xl/main:grid-cols-4")
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
