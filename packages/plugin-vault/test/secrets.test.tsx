import { describe, expect, it } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { SecretsPage } from "../src/pages/secrets"
import { secretPath } from "../src/keys"
import {
  failingClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

const NOTE = /Secrets marked Not encrypted were stored while this vault had no encryption key/

function secret(over: Record<string, unknown> = {}) {
  return {
    id: "sec_01",
    key: "db/primary.password",
    version: 3,
    encryptionAlg: "AES-256-GCM",
    appId: "app_1",
    createdAt: "2026-09-20T10:00:00Z",
    updatedAt: "2026-09-23T10:00:00Z",
    ...over,
  }
}

const ENCRYPTED = {
  secrets: [
    secret(),
    secret({
      id: "sec_02",
      key: "api-token",
      version: 1,
      expiresAt: "2027-01-01T00:00:00Z",
    }),
  ],
  total: 2,
}

const MIXED = {
  secrets: [secret(), secret({ id: "sec_03", key: "legacy", encryptionAlg: "" })],
  total: 2,
}

describe("SecretsPage", () => {
  it("asks secrets.list for the first page with an exact limit and offset", async () => {
    const { client, sent } = recordingQueryClient({ "secrets.list": ENCRYPTED })
    renderPage(SecretsPage, client)
    await screen.findByText("api-token")
    const list = sent.filter((i) => i.intent === "secrets.list")
    expect(list.length).toBeGreaterThan(0)
    expect(list[0]?.params).toEqual({ limit: 25, offset: 0 })
  })

  it("shows the server total in the caption, not the page length", async () => {
    renderPage(
      SecretsPage,
      stubClient({ "secrets.list": { secrets: ENCRYPTED.secrets, total: 31 } })
    )
    await screen.findByText("api-token")
    expect(screen.getByText("31 secrets")).toBeTruthy()
  })

  it("uses the singular for a total of one", async () => {
    renderPage(
      SecretsPage,
      stubClient({ "secrets.list": { secrets: [secret()], total: 1 } })
    )
    await screen.findByText("db/primary.password")
    expect(screen.getByText("1 secret")).toBeTruthy()
  })

  it("says so and still counts when there are no secrets", async () => {
    renderPage(SecretsPage, stubClient({ "secrets.list": { secrets: [], total: 0 } }))
    expect(await screen.findByText("No secrets yet.")).toBeTruthy()
    expect(screen.getByText("0 secrets")).toBeTruthy()
    // One in the header, one as the empty state's action.
    const links = screen.getAllByRole("link", { name: "New secret" })
    expect(links).toHaveLength(2)
    for (const l of links) expect(l.getAttribute("href")).toBe("/new-secret")
    expect(screen.queryByText(NOTE)).toBeNull()
  })

  it("pages to offset 25 on page two", async () => {
    const { client, sent } = recordingQueryClient({
      "secrets.list": { secrets: ENCRYPTED.secrets, total: 31 },
    })
    renderPage(SecretsPage, client)
    await screen.findByText("api-token")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText(/Page 2 of 2/)
    const params = sent
      .filter((i) => i.intent === "secrets.list")
      .map((i) => i.params)
    expect(params).toContainEqual({ limit: 25, offset: 25 })
  })

  it("marks an unencrypted row destructively and explains it", async () => {
    renderPage(SecretsPage, stubClient({ "secrets.list": MIXED }))
    await screen.findByText("legacy")
    const badge = screen.getByText("Not encrypted", {
      selector: '[data-slot="badge"]',
    })
    expect(badge.className).toMatch(/destructive/)
    expect(screen.getByText(NOTE)).toBeTruthy()
    // The note says nothing about a row being safe.
    expect(screen.getByText(NOTE).textContent).not.toMatch(/\bsecure|\bprotected/i)
  })

  it("shows no note when every row on the page is encrypted", async () => {
    renderPage(SecretsPage, stubClient({ "secrets.list": ENCRYPTED }))
    await screen.findByText("api-token")
    expect(screen.queryByText(NOTE)).toBeNull()
    expect(screen.getAllByText("AES-256-GCM", { selector: '[data-slot="badge"]' })).toHaveLength(2)
  })

  it("links each key through secretPath, encoding slashes and dots", async () => {
    renderPage(SecretsPage, stubClient({ "secrets.list": ENCRYPTED }))
    const link = await screen.findByRole("link", { name: "db/primary.password" })
    expect(link.getAttribute("href")).toBe(secretPath("db/primary.password"))
    expect(link.getAttribute("href")).toBe("/secrets/db%2Fprimary.password")
    expect(link.closest("td")?.className).toMatch(/font-mono text-xs font-medium/)
  })

  it("links a key that is literally new to its detail path", async () => {
    renderPage(
      SecretsPage,
      stubClient({ "secrets.list": { secrets: [secret({ key: "new" })], total: 1 } })
    )
    const link = await screen.findByRole("link", { name: "new" })
    expect(link.getAttribute("href")).toBe("/secrets/new")
  })

  it("sends New secret to /new-secret", async () => {
    renderPage(SecretsPage, stubClient({ "secrets.list": ENCRYPTED }))
    await screen.findByText("api-token")
    const link = screen.getByRole("link", { name: "New secret" })
    expect(link.getAttribute("href")).toBe("/new-secret")
  })

  it("reads an absent expiry as no expiry, and a present one as a date", async () => {
    renderPage(SecretsPage, stubClient({ "secrets.list": ENCRYPTED }))
    await screen.findByText("api-token")
    const rows = screen.getAllByRole("row")
    const primary = rows.find((r) => within(r).queryByText("db/primary.password"))!
    const token = rows.find((r) => within(r).queryByText("api-token"))!
    expect(within(primary).getByLabelText(/no expiry/i)).toBeTruthy()
    expect(within(token).queryByLabelText(/no expiry/i)).toBeNull()
    expect(within(primary).getByText("v3")).toBeTruthy()
  })

  it("renders the error card, not an empty table, when the list fails", async () => {
    renderPage(
      SecretsPage,
      failingClient(new ContractError("INTERNAL", "vault store is down"))
    )
    expect(await screen.findByText(/Secrets unavailable/i)).toBeTruthy()
    expect(screen.getByText(/vault store is down/)).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.queryByText("No secrets yet.")).toBeNull()
  })

  it("states that values are write-only", async () => {
    renderPage(SecretsPage, stubClient({ "secrets.list": ENCRYPTED }))
    expect(
      await screen.findByText(
        "Values are write-only: you can set and replace them here, never read them back."
      )
    ).toBeTruthy()
  })
})
