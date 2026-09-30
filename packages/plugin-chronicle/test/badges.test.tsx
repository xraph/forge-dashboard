import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { CoverageBadge, ErasedBadge, OutcomeBadge, SeverityBadge } from "../src/badges"

const variantOf = (el: HTMLElement) => el.getAttribute("data-variant")

describe("the badge mapping", () => {
  it("keeps the majority outcome quiet and marks failure and denial", () => {
    render(<><OutcomeBadge outcome="success" /><OutcomeBadge outcome="failure" /><OutcomeBadge outcome="denied" /></>)
    expect(variantOf(screen.getByText("success"))).toBe("outline")
    expect(variantOf(screen.getByText("failure"))).toBe("destructive")
    expect(variantOf(screen.getByText("denied"))).toBe("destructive")
  })
  it("ramps severity: info outline, warning secondary, critical destructive", () => {
    render(<><SeverityBadge severity="info" /><SeverityBadge severity="warning" /><SeverityBadge severity="critical" /></>)
    expect(variantOf(screen.getByText("info"))).toBe("outline")
    expect(variantOf(screen.getByText("warning"))).toBe("secondary")
    expect(variantOf(screen.getByText("critical"))).toBe("destructive")
  })
  it("shows an unknown outcome or severity as outline text, not as a fault", () => {
    render(<><OutcomeBadge outcome="partial" /><SeverityBadge severity="debug" /></>)
    expect(variantOf(screen.getByText("partial"))).toBe("outline")
    expect(variantOf(screen.getByText("debug"))).toBe("outline")
  })
  it("ranks coverage: unkeyed secondary, keyed outline, signed and anchored default", () => {
    render(<><CoverageBadge level="unkeyed" /><CoverageBadge level="keyed" /><CoverageBadge level="signed" /><CoverageBadge level="anchored" /></>)
    expect(variantOf(screen.getByText("unkeyed"))).toBe("secondary")
    expect(variantOf(screen.getByText("keyed"))).toBe("outline")
    expect(variantOf(screen.getByText("signed"))).toBe("default")
    expect(variantOf(screen.getByText("anchored"))).toBe("default")
  })
  it("never marks an erasure as a fault", () => {
    render(<ErasedBadge />)
    expect(variantOf(screen.getByText("Erased"))).toBe("secondary")
  })
})
