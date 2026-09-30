import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { RecentActivity } from "../src/components/recent-activity"
import type { AuditEntry } from "../src/flag-types"

function entry(over: Partial<AuditEntry>): AuditEntry {
  return {
    id: "a1",
    action: "config.update",
    outcome: "success",
    createdAt: "2026-09-30T10:00:00Z",
    ...over,
  }
}

function rowOf(action: string): HTMLElement {
  return screen.getByText(action).closest("li") as HTMLElement
}

describe("RecentActivity", () => {
  it("labels the user as who did it", () => {
    render(<RecentActivity entries={[entry({ userId: "u-rex" })]} />)
    const row = rowOf("config.update")
    expect(within(row).getByText("u-rex")).toBeTruthy()
    expect(row.textContent).toContain("by u-rex")
    expect(row.textContent).not.toMatch(/tenant/)
  })

  it("labels the tenant, and shows no user, on an app write", () => {
    render(
      <RecentActivity
        entries={[entry({ action: "config.override.set", tenantId: "t-acme" })]}
      />
    )
    const row = rowOf("config.override.set")
    expect(row.textContent).toContain("tenant t-acme")
    // The tenant is never read as the actor.
    expect(row.textContent).not.toMatch(/\bby\b/)
    expect(row.textContent).not.toMatch(/user/i)
  })

  it("labels both when a user wrote for a tenant", () => {
    render(
      <RecentActivity
        entries={[entry({ action: "config.override.set", userId: "u-rex", tenantId: "t-acme" })]}
      />
    )
    const row = rowOf("config.override.set")
    expect(row.textContent).toContain("by u-rex")
    expect(row.textContent).toContain("tenant t-acme")
    expect(row.textContent).not.toContain("by t-acme")
  })

  it("shows neither label when the row has neither", () => {
    render(<RecentActivity entries={[entry({})]} />)
    const row = rowOf("config.update")
    expect(row.textContent).not.toMatch(/\bby\b/)
    expect(row.textContent).not.toMatch(/tenant/)
  })

  it("shows a failure row's error under it", () => {
    render(
      <RecentActivity
        entries={[entry({ action: "secret.rotated", outcome: "failure", error: "rotator refused" })]}
      />
    )
    expect(within(rowOf("secret.rotated")).getByText("rotator refused")).toBeTruthy()
  })
})
