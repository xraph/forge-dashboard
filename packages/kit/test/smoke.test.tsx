import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { Badge } from "../src/components/badge"

describe("kit test harness", () => {
  it("renders a kit component", () => {
    render(<Badge>ready</Badge>)
    expect(screen.getByText("ready")).toBeTruthy()
  })
})
