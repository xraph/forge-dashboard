import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { KeyStateBadge, RotationReasonBadge } from "../src/badges"
import type { KeySummary } from "../src/types"

function summary(over: Partial<KeySummary>): KeySummary {
  return {
    id: "akey_1",
    name: "Billing service",
    prefix: "sk",
    hint: "a3f8",
    environment: "live",
    state: "active",
    effectiveState: "active",
    expiryPending: false,
    expiresSoon: false,
    scopes: [],
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...over,
  }
}

function badge(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-slot="badge"]')
  if (!el) throw new Error("no badge rendered")
  return el
}

/** The class each kit Badge variant carries that no other variant does. */
const VARIANT_CLASS = {
  outline: "border-border",
  destructive: "bg-destructive/10",
  secondary: "bg-secondary",
  default: "bg-primary",
} as const

function expectVariant(variant: keyof typeof VARIANT_CLASS) {
  const classes = badge().className.split(/\s+/)
  expect(classes).toContain(VARIANT_CLASS[variant])
  for (const [other, cls] of Object.entries(VARIANT_CLASS)) {
    if (other !== variant) expect(classes).not.toContain(cls)
  }
}

describe("KeyStateBadge", () => {
  it("shows an active key as an outline", () => {
    render(<KeyStateBadge summary={summary({})} />)
    expect(badge().textContent).toBe("Active")
    expectVariant("outline")
  })

  it("shows an active key that expires within a week as a destructive 'Expires soon'", () => {
    render(<KeyStateBadge summary={summary({ expiresSoon: true })} />)
    expect(badge().textContent).toBe("Expires soon")
    expectVariant("destructive")
  })

  it("shows an expired key whose expiry is not yet marked as a secondary 'Expired'", () => {
    render(
      <KeyStateBadge
        summary={summary({ effectiveState: "expired", expiryPending: true })}
      />
    )
    expect(badge().textContent).toContain("Expired")
    expectVariant("secondary")
  })

  it("gives the pending expiry note to a screen reader as sr-only text inside the badge", () => {
    render(
      <KeyStateBadge
        summary={summary({ effectiveState: "expired", expiryPending: true })}
      />
    )
    const note = badge().querySelector(".sr-only")
    expect(note?.textContent).toContain(
      "not yet marked; Keysmith marks expiry when the key is next used"
    )
  })

  it("does not add the note to an expired key that is already marked", () => {
    render(<KeyStateBadge summary={summary({ effectiveState: "expired" })} />)
    expect(badge().textContent).toBe("Expired")
    expect(badge().querySelector(".sr-only")).toBeNull()
    expectVariant("secondary")
  })

  it("shows a suspended key as a default badge", () => {
    render(<KeyStateBadge summary={summary({ effectiveState: "suspended" })} />)
    expect(badge().textContent).toBe("Suspended")
    expectVariant("default")
  })

  it("shows a revoked key as a secondary badge", () => {
    render(<KeyStateBadge summary={summary({ effectiveState: "revoked" })} />)
    expect(badge().textContent).toBe("Revoked")
    expectVariant("secondary")
  })

  it("ignores expiresSoon on a key that is not active", () => {
    render(
      <KeyStateBadge
        summary={summary({ effectiveState: "suspended", expiresSoon: true })}
      />
    )
    expect(badge().textContent).toBe("Suspended")
  })
})

describe("RotationReasonBadge", () => {
  it("shows a compromise as destructive, the rotation someone scans for", () => {
    render(<RotationReasonBadge reason="compromise" />)
    expect(badge().textContent).toBe("Compromise")
    expectVariant("destructive")
  })

  it("shows a policy rotation as secondary", () => {
    render(<RotationReasonBadge reason="policy" />)
    expect(badge().textContent).toBe("Policy")
    expectVariant("secondary")
  })

  it("shows a manual rotation as an outline", () => {
    render(<RotationReasonBadge reason="manual" />)
    expect(badge().textContent).toBe("Manual")
    expectVariant("outline")
  })

  it("shows a scheduled rotation as an outline", () => {
    render(<RotationReasonBadge reason="scheduled" />)
    expect(badge().textContent).toBe("Scheduled")
    expectVariant("outline")
  })

  it("shows a reason it does not know by name as written, in an outline", () => {
    render(<RotationReasonBadge reason="imported" />)
    expect(badge().textContent).toBe("imported")
    expectVariant("outline")
  })
})
