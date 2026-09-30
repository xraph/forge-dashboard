import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { OverviewPage } from "../src/pages/overview"
import type { OverviewStats } from "../src/pages/overview"
import { failingClient, recordingQueryClient, renderPage, stubClient } from "./harness"

function stats(over: Partial<OverviewStats> = {}): OverviewStats {
  return {
    secrets: 12,
    unencryptedSecrets: 0,
    flags: 5,
    configEntries: 7,
    configOverrides: 3,
    rotationPolicies: 4,
    rotationEnabled: 3,
    rotationOverdue: 0,
    rotationWithoutRotator: 0,
    rotationFailures24h: 0,
    encryptionEnabled: true,
    encryptionAlgorithm: "AES-256-GCM",
    recentActivity: [],
    ...over,
  }
}

function show(over: Partial<OverviewStats> = {}) {
  return renderPage(OverviewPage, stubClient({ "overview.stats": stats(over) }))
}

const NOTHING = "Nothing needs attention."
const UNENCRYPTED = /secrets? (is|are) stored without encryption\./
const OVERDUE = /rotation polic(y|ies) (is|are) overdue\./
const NO_ROTATOR = /enabled polic(y|ies) (has|have) no rotator and will never rotate\./
const FAILED = /rotation attempts? failed in the last 24 hours\./

describe("OverviewPage", () => {
  it("asks overview.stats with no parameters", async () => {
    const { client, sent } = recordingQueryClient({ "overview.stats": stats() })
    renderPage(OverviewPage, client)
    await screen.findByText(NOTHING)
    expect(sent.filter((i) => i.intent === "overview.stats")[0]?.params).toEqual({})
  })

  it("says nothing needs attention when every problem count is zero", async () => {
    show()
    expect(await screen.findByText(NOTHING)).toBeTruthy()
    expect(screen.queryByText("Needs attention")).toBeNull()
    expect(screen.queryByText(UNENCRYPTED)).toBeNull()
    expect(screen.queryByText(OVERDUE)).toBeNull()
    expect(screen.queryByText(NO_ROTATOR)).toBeNull()
    expect(screen.queryByText(FAILED)).toBeNull()
  })

  it("lists unencrypted secrets alone, linked to the secrets list", async () => {
    show({ unencryptedSecrets: 3 })
    const line = await screen.findByText("3 secrets are stored without encryption.")
    expect(line.closest("a")?.getAttribute("href")).toBe("/secrets")
    expect(screen.getByText("Needs attention")).toBeTruthy()
    expect(screen.queryByText(NOTHING)).toBeNull()
    expect(screen.queryByText(OVERDUE)).toBeNull()
    expect(screen.queryByText(NO_ROTATOR)).toBeNull()
    expect(screen.queryByText(FAILED)).toBeNull()
  })

  it("uses the singular for a count of one", async () => {
    show({ unencryptedSecrets: 1, rotationOverdue: 1, rotationWithoutRotator: 1, rotationFailures24h: 1 })
    expect(await screen.findByText("1 secret is stored without encryption.")).toBeTruthy()
    expect(screen.getByText("1 rotation policy is overdue.")).toBeTruthy()
    expect(
      screen.getByText("1 enabled policy has no rotator and will never rotate.")
    ).toBeTruthy()
    expect(screen.getByText("1 rotation attempt failed in the last 24 hours.")).toBeTruthy()
  })

  it("lists overdue policies alone, linked to the rotation list", async () => {
    show({ rotationOverdue: 2 })
    const line = await screen.findByText("2 rotation policies are overdue.")
    expect(line.closest("a")?.getAttribute("href")).toBe("/rotation")
    expect(screen.queryByText(UNENCRYPTED)).toBeNull()
    expect(screen.queryByText(NO_ROTATOR)).toBeNull()
    expect(screen.queryByText(FAILED)).toBeNull()
    expect(screen.queryByText(NOTHING)).toBeNull()
  })

  it("lists enabled policies with no rotator alone, linked to the rotation list", async () => {
    show({ rotationWithoutRotator: 2 })
    const line = await screen.findByText(
      "2 enabled policies have no rotator and will never rotate."
    )
    expect(line.closest("a")?.getAttribute("href")).toBe("/rotation")
    expect(screen.queryByText(UNENCRYPTED)).toBeNull()
    expect(screen.queryByText(OVERDUE)).toBeNull()
    expect(screen.queryByText(FAILED)).toBeNull()
    expect(screen.queryByText(NOTHING)).toBeNull()
  })

  it("lists failed rotations alone, linked to the audit log filtered to them", async () => {
    show({ rotationFailures24h: 4 })
    const line = await screen.findByText("4 rotation attempts failed in the last 24 hours.")
    const href = line.closest("a")?.getAttribute("href") ?? ""
    const url = new URL(href, "http://x")
    expect(url.pathname).toBe("/audit")
    expect(url.searchParams.get("action")).toBe("secret.rotated")
    expect(url.searchParams.get("outcome")).toBe("failure")
    // The count is the last 24 hours, so the link is too.
    const since = url.searchParams.get("since") ?? ""
    expect(since).toBe(new Date(since).toISOString())
    const ago = Date.now() - Date.parse(since)
    expect(Math.abs(ago - 24 * 60 * 60 * 1000)).toBeLessThan(60_000)
    expect(screen.queryByText(UNENCRYPTED)).toBeNull()
    expect(screen.queryByText(OVERDUE)).toBeNull()
    expect(screen.queryByText(NO_ROTATOR)).toBeNull()
    expect(screen.queryByText(NOTHING)).toBeNull()
  })

  it("lists every problem at once", async () => {
    show({
      unencryptedSecrets: 2,
      rotationOverdue: 2,
      rotationWithoutRotator: 2,
      rotationFailures24h: 2,
    })
    await screen.findByText("Needs attention")
    expect(screen.getByText(UNENCRYPTED)).toBeTruthy()
    expect(screen.getByText(OVERDUE)).toBeTruthy()
    expect(screen.getByText(NO_ROTATOR)).toBeTruthy()
    expect(screen.getByText(FAILED)).toBeTruthy()
    expect(screen.queryByText(NOTHING)).toBeNull()
  })

  it("names the algorithm when a key is configured and every secret is encrypted", async () => {
    show()
    expect(await screen.findByText("New secrets are encrypted with AES-256-GCM.")).toBeTruthy()
  })

  it("does not call the vault encrypted while an unencrypted secret exists", async () => {
    show({ unencryptedSecrets: 2 })
    await screen.findByText("Needs attention")
    expect(screen.queryByText("New secrets are encrypted with AES-256-GCM.")).toBeNull()
    expect(
      screen.getByText(
        "New secrets are encrypted with AES-256-GCM, but secrets stored without encryption stay that way until their values are replaced."
      )
    ).toBeTruthy()
  })

  it("says so in the destructive tone when no key is configured", async () => {
    show({ encryptionEnabled: false, encryptionAlgorithm: "" })
    const line = await screen.findByText(
      "No encryption key is configured, so new secrets are stored unencrypted."
    )
    expect(line.className).toMatch(/destructive/)
    // A vault with no key is not one where nothing needs attention.
    expect(screen.queryByText(NOTHING)).toBeNull()
    expect(screen.queryByText(/New secrets are encrypted/)).toBeNull()
  })

  it("shows the counts, and shows zeros as zeros", async () => {
    show({
      secrets: 0,
      flags: 0,
      configEntries: 0,
      configOverrides: 0,
      rotationPolicies: 0,
      rotationEnabled: 0,
    })
    await screen.findByText(NOTHING)
    for (const label of ["Secrets", "Flags", "Config entries", "Config overrides", "Rotation policies"]) {
      const card = screen.getByText(label).closest("[data-slot=card]") as HTMLElement
      expect(card.textContent).toContain("0")
    }
    expect(screen.getByText("0 enabled")).toBeTruthy()
  })

  it("shows each count with its label and the enabled hint", async () => {
    show()
    await screen.findByText(NOTHING)
    const value = (label: string) =>
      (screen.getByText(label).closest("[data-slot=card]") as HTMLElement).textContent
    expect(value("Secrets")).toContain("12")
    expect(value("Flags")).toContain("5")
    expect(value("Config entries")).toContain("7")
    expect(value("Config overrides")).toContain("3")
    expect(value("Rotation policies")).toContain("4")
    expect(screen.getByText("3 enabled")).toBeTruthy()
  })

  it("lists recent activity and links to the audit log", async () => {
    show({
      recentActivity: [
        {
          id: "a1",
          action: "secret.set",
          resource: "secret",
          key: "db/password",
          outcome: "success",
          userId: "user_9",
          createdAt: "2026-09-30T10:00:00Z",
        },
        {
          id: "a2",
          action: "secret.rotated",
          resource: "secret",
          key: "api-token",
          outcome: "failure",
          error: "rotator refused",
          createdAt: "2026-09-30T09:00:00Z",
        },
      ],
    })
    await screen.findByText("Recent activity")
    expect(screen.getByText("secret.set")).toBeTruthy()
    expect(screen.getByText("db/password")).toBeTruthy()
    expect(screen.getByText("user_9")).toBeTruthy()
    expect(screen.getByText("rotator refused")).toBeTruthy()
    const link = screen.getByRole("link", { name: "See the audit log" })
    expect(link.getAttribute("href")).toBe("/audit")
  })

  it("says so when there is no recent activity, and still links to the audit log", async () => {
    show()
    expect(await screen.findByText("No recorded activity yet.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "See the audit log" })).toBeTruthy()
  })

  it("renders the query error and never zeros or an all clear", async () => {
    renderPage(OverviewPage, failingClient(new ContractError("INTERNAL", "count failed")))
    expect(await screen.findByText(/INTERNAL: count failed/)).toBeTruthy()
    expect(screen.queryByText(NOTHING)).toBeNull()
    expect(screen.queryByText("Secrets")).toBeNull()
    expect(screen.queryByText(/New secrets are encrypted/)).toBeNull()
  })
})
