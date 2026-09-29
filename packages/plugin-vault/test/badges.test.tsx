import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import {
  EncryptionBadge,
  PolicyStatusBadge,
  RotatorBadge,
} from "../src/badges"

function badge() {
  const el = document.querySelector('[data-slot="badge"]')
  if (!el) throw new Error("no badge rendered")
  return el
}

describe("EncryptionBadge", () => {
  it("says only 'Not encrypted' for an empty algorithm, destructively", () => {
    render(<EncryptionBadge alg="" />)
    expect(badge().textContent).toBe("Not encrypted")
    expect(badge().className).toContain("text-destructive")
  })

  it("never claims secure or protected for an empty algorithm", () => {
    const { container } = render(<EncryptionBadge alg="" />)
    const text = container.textContent ?? ""
    expect(text.replace("Not encrypted", "")).not.toMatch(
      /encrypted|secure|protected/i,
    )
  })

  it("shows a non-empty algorithm by name, as an outline", () => {
    render(<EncryptionBadge alg="AES-256-GCM" />)
    expect(screen.getByText("AES-256-GCM")).toBe(badge())
    expect(badge().className).toContain("border-border")
    expect(badge().className).not.toContain("text-destructive")
  })
})

describe("PolicyStatusBadge", () => {
  it("shows Enabled as an outline", () => {
    render(<PolicyStatusBadge enabled />)
    expect(badge().textContent).toBe("Enabled")
    expect(badge().className).toContain("border-border")
  })

  it("shows Disabled as secondary", () => {
    render(<PolicyStatusBadge enabled={false} />)
    expect(badge().textContent).toBe("Disabled")
    expect(badge().className).toContain("bg-secondary")
  })
})

describe("RotatorBadge", () => {
  it("shows a registered rotator as the default variant", () => {
    render(<RotatorBadge rotatable />)
    expect(badge().textContent).toBe("Rotator registered")
    expect(badge().className).toContain("bg-primary")
  })

  it("shows no rotator as an outline", () => {
    render(<RotatorBadge rotatable={false} />)
    expect(badge().textContent).toBe("No rotator")
    expect(badge().className).toContain("border-border")
    expect(badge().className).not.toContain("bg-primary")
  })
})
