import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import {
  DocumentStateBadge,
  DocumentStateCell,
  StalledMarker,
} from "../src/badges"

type Variant = "default" | "secondary" | "destructive" | "outline"

/**
 * The kit's Badge carries no data-variant attribute, so a badge's variant is
 * read by comparing its classes with a reference Badge of each variant.
 */
function variantOf(text: string | RegExp): Variant | null {
  const el = screen.getByText(text)
  for (const v of ["default", "secondary", "destructive", "outline"] as const) {
    const { container, unmount } = render(<Badge variant={v}>ref</Badge>)
    const ref = container.firstElementChild?.className
    unmount()
    if (ref === el.className) return v
  }
  return null
}

describe("DocumentStateBadge", () => {
  it.each([
    ["ready", "outline"],
    ["pending", "secondary"],
    ["processing", "default"],
    ["failed", "destructive"],
  ] as const)("%s is %s", (state, variant) => {
    render(<DocumentStateBadge state={state} />)
    expect(variantOf(state)).toBe(variant)
  })
})

describe("StalledMarker", () => {
  it("states the real age and is destructive", () => {
    const now = Date.parse("2026-10-07T12:00:00Z")
    render(<StalledMarker updatedAt="2026-10-07T09:00:00Z" now={now} />)
    expect(variantOf("no update for 3 h")).toBe("destructive")
  })
})

describe("DocumentStateCell", () => {
  it("adds the marker only to a row the server calls stalled", () => {
    const old = "2020-01-01T00:00:00Z"
    const { unmount } = render(
      <DocumentStateCell
        doc={{ state: "processing", stalled: false, updated_at: old }}
      />
    )
    expect(screen.queryByText(/no update for/)).toBeNull()
    unmount()
    render(
      <DocumentStateCell
        doc={{ state: "processing", stalled: true, updated_at: old }}
      />
    )
    expect(screen.getByText("processing")).toBeTruthy()
    expect(screen.getByText(/no update for \d+ d/)).toBeTruthy()
  })
})
