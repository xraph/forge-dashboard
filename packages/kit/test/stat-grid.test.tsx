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
      />,
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
    render(<StatGrid items={[{ label: "Uptime", value: "3h 2m", hint: "since restart" }]} />)
    expect(screen.getByText("since restart")).toBeTruthy()
  })
})
