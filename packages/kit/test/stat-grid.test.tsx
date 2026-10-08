import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { StatGrid } from "../src/components/stat-grid"

describe("StatGrid", () => {
  it("renders one card per item, label and value both visible", () => {
    render(
      <StatGrid
        items={[
          { label: "Connections", value: 12 },
          { label: "Rooms", value: 3 },
        ]}
      />
    )
    expect(screen.getByText("Connections")).toBeTruthy()
    expect(screen.getByText("12")).toBeTruthy()
    expect(screen.getByText("Rooms")).toBeTruthy()
    expect(screen.getByText("3")).toBeTruthy()
  })

  it("renders a zero rather than treating it as missing", () => {
    render(<StatGrid items={[{ label: "Rooms", value: 0 }]} />)
    expect(screen.getByText("0")).toBeTruthy()
  })

  it("renders a hint when given one", () => {
    render(
      <StatGrid
        items={[{ label: "Uptime", value: "3h 2m", hint: "since restart" }]}
      />
    )
    expect(screen.getByText("since restart")).toBeTruthy()
  })

  it("marks an untoned card as default and adds no emphasis classes", () => {
    render(<StatGrid items={[{ label: "Rooms", value: 3 }]} />)
    const card = screen.getByText("Rooms").closest("[data-slot=card]")
    expect(card?.getAttribute("data-tone")).toBe("default")
    expect(card?.className).not.toMatch(/ring-(destructive|warning|success)/)
    expect(screen.getByText("3").className).not.toMatch(
      /text-(destructive|warning|success)/
    )
  })

  it.each([
    ["danger", "ring-destructive/50", "text-destructive"],
    ["warning", "ring-warning/50", "text-warning-foreground"],
    ["success", "ring-success/50", "text-success-foreground"],
  ] as const)(
    "a %s tone sets a stable attribute, the ring and the value colour",
    (tone, ring, text) => {
      render(
        <StatGrid
          items={[
            { label: "Quiet", value: 1 },
            { label: "Loud", value: 2, tone },
          ]}
        />
      )
      const card = screen.getByText("Loud").closest("[data-slot=card]")
      expect(card?.getAttribute("data-tone")).toBe(tone)
      expect(card?.className).toContain(ring)
      expect(screen.getByText("2").className).toContain(text)
      const quiet = screen.getByText("Quiet").closest("[data-slot=card]")
      expect(quiet?.getAttribute("data-tone")).toBe("default")
      expect(quiet?.className).not.toContain(ring)
    }
  )
})
