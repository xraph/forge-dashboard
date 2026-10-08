import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import {
  CasStateBadge,
  FlagStateBadge,
  HealthBadge,
  StreamStateBadge,
} from "../src/badges"

type Variant = "default" | "secondary" | "destructive" | "outline"

/**
 * The kit's Badge carries no data-variant attribute, so a badge's variant is
 * read by comparing its classes with a reference Badge of each variant.
 */
function variantOf(text: string): Variant | null {
  const el = screen.getByText(text)
  for (const v of ["default", "secondary", "destructive", "outline"] as const) {
    const { container, unmount } = render(<Badge variant={v}>ref</Badge>)
    const ref = container.firstElementChild?.className
    unmount()
    if (ref === el.className) return v
  }
  return null
}

describe("FlagStateBadge", () => {
  it.each([
    [
      { name: "encryption", configured: true, applied: false, note: null },
      "Configured, not applied",
      "destructive",
    ],
    [
      { name: "compression", configured: true, applied: true, note: null },
      "Applied",
      "outline",
    ],
    [
      { name: "scanning", configured: false, applied: true, note: null },
      "Applied",
      "outline",
    ],
    [
      { name: "cas", configured: false, applied: false, note: null },
      "Not configured",
      "secondary",
    ],
  ])("%o reads %s as %s", (flag, text, variant) => {
    render(<FlagStateBadge flag={flag} />)
    expect(variantOf(text)).toBe(variant)
  })
})

describe("HealthBadge", () => {
  it("is outline when healthy and destructive when not", () => {
    render(
      <>
        <HealthBadge ok />
        <HealthBadge ok={false} />
      </>
    )
    expect(variantOf("Healthy")).toBe("outline")
    expect(variantOf("Unhealthy")).toBe("destructive")
  })
})

describe("CasStateBadge", () => {
  const base = { hash: "sha256:a", storedSize: 1, lastModified: null }
  it.each([
    [
      { ...base, indexed: true, refCount: 2, pinned: false },
      "Indexed",
      "outline",
    ],
    [
      { ...base, indexed: true, refCount: 1, pinned: true },
      "Pinned",
      "secondary",
    ],
    [
      { ...base, indexed: true, refCount: 0, pinned: false },
      "GC candidate",
      "default",
    ],
    [
      { ...base, indexed: false, refCount: null, pinned: null },
      "Not indexed",
      "destructive",
    ],
  ])("%o reads %s as %s", (entry, text, variant) => {
    render(<CasStateBadge entry={entry} />)
    expect(variantOf(text)).toBe(variant)
  })
})

describe("StreamStateBadge", () => {
  it.each([
    ["active", "outline"],
    ["idle", "secondary"],
    ["paused", "secondary"],
    ["completing", "default"],
    ["completed", "default"],
    ["failed", "destructive"],
    ["cancelled", "destructive"],
  ])("%s is %s", (state, variant) => {
    render(<StreamStateBadge state={state} />)
    expect(variantOf(state)).toBe(variant)
  })
})
