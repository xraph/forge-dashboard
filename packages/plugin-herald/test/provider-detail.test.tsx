import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ProviderDetailPage } from "../src/pages/provider-detail"
import { engine, providerDetail } from "./data"
import { invalidatingClient, renderPage, renderWithNavigate, scriptedClient } from "./harness"

const ID = "hpvd_01j00000000000000000000001"

function client(detail = providerDetail(), onDelete: () => unknown = () => ({ ok: true, id: ID })) {
  return scriptedClient({ "engine.info": engine(), "providers.detail": { provider: detail } }, { "providers.delete": onDelete })
}

describe("ProviderDetailPage", () => {
  it("asks for the provider by id", async () => {
    const c = client()
    renderPage(ProviderDetailPage, c.client, { id: ID })
    await screen.findByRole("heading", { level: 1, name: "Primary SMTP" })
    expect(c.queried.find((q) => q.intent === "providers.detail")?.params).toEqual({ id: ID })
  })

  it("lists settings with values, and secret ones without", async () => {
    const detail = providerDetail({ settings: [{ key: "host", value: "smtp.example.com", secret: false }, { key: "gateway_token", secret: true }] })
    renderPage(ProviderDetailPage, client(detail).client, { id: ID })
    const table = await screen.findByRole("table", { name: /2 settings/ })
    expect(within(table).getByText("smtp.example.com").className).toMatch(/font-mono/)
    const secretRow = within(table).getAllByRole("row").find((r) => within(r).queryByText("gateway_token"))!
    expect(within(secretRow).getByText("Hidden")).toBeTruthy()
  })

  it("shows each credential's protection and key ID, never a value", async () => {
    const detail = providerDetail({ credentials: [{ key: "password", protection: "aes-256-gcm", keyId: "k1" }, { key: "username", protection: "plaintext" }] })
    renderPage(ProviderDetailPage, client(detail).client, { id: ID })
    const table = await screen.findByRole("table", { name: /2 credentials/ })
    expect(within(table).getByText("Encrypted", { selector: '[data-slot="badge"]' })).toBeTruthy()
    expect(within(table).getByText("Plaintext", { selector: '[data-slot="badge"]' })).toBeTruthy()
    expect(within(table).getByText("k1").className).toMatch(/font-mono text-xs/)
    expect(within(table).getByLabelText("no key ID")).toBeTruthy()
  })

  it("lists the routing rules that name it, and says when none do", async () => {
    renderPage(ProviderDetailPage, client().client, { id: ID })
    expect(await screen.findByText(/app rule/)).toBeTruthy()
    const item = screen.getByText(/app rule/).closest("li")!
    expect(within(item).getByText("app_demo").className).toMatch(/font-mono text-xs/)
  })

  it("explains fallback use when no rule names it", async () => {
    renderPage(ProviderDetailPage, client(providerDetail({ usedBy: [] })).client, { id: ID })
    expect(await screen.findByText(/No routing rule names this provider/)).toBeTruthy()
  })

  it("links to edit and to a test send pinned to this provider", async () => {
    renderPage(ProviderDetailPage, client().client, { id: ID })
    expect((await screen.findByRole("link", { name: "Edit" })).getAttribute("href")).toBe(`/providers/${ID}/edit`)
    expect(screen.getByRole("link", { name: "Send a test through this provider" }).getAttribute("href")).toBe(`/providers/${ID}/send-test`)
  })

  it("names the rules that will dangle before deleting, sends only the id, and goes back to the list", async () => {
    const c = client()
    const { navigate } = renderWithNavigate(ProviderDetailPage, c.client, { id: ID })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toMatch(/1 routing rule names this provider: app app_demo \(email\)/)
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "providers.delete", payload: { id: ID } }]))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/providers"))
  })

  it("keeps the dialog open and shows the refusal inside it", async () => {
    renderPage(ProviderDetailPage, client(providerDetail(), () => new ContractError("NOT_FOUND", "provider not found")).client, { id: ID })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect((await within(dialog).findByRole("alert")).textContent).toContain("provider not found")
  })

  it("keeps the dialog up while the delete's own refetch fails, then goes back to the list", async () => {
    const { client: base, queried, sent } = invalidatingClient(
      {
        "engine.info": engine(),
        "providers.detail": (_input, call) => (call === 0 ? { provider: providerDetail() } : new ContractError("NOT_FOUND", "provider not found")),
      },
      { "providers.delete": { answer: { ok: true, id: ID }, invalidates: ["providers.list", "providers.detail", "overview.stats", "scopes.list"] } },
    )
    // Hold the command's answer after it has invalidated, so the page is
    // looking at its refetch while the delete is still in flight.
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const client = {
      ...base,
      command: async (intent: string, payload?: unknown) => {
        const out = await base.command(intent, payload)
        await gate
        return out
      },
    } as typeof base
    const { navigate } = renderWithNavigate(ProviderDetailPage, client, { id: ID })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(queried.filter((q) => q.intent === "providers.detail")).toHaveLength(2))
    await screen.findByText(/Provider unavailable/)
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    release()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/providers"))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(sent).toEqual([{ intent: "providers.delete", payload: { id: ID } }])
  })

  it("renders another app's provider as not found, not as an empty page", async () => {
    renderPage(ProviderDetailPage, scriptedClient({ "engine.info": engine(), "providers.detail": () => new ContractError("NOT_FOUND", "provider not found") }).client, { id: ID })
    expect(await screen.findByText(/Provider unavailable/)).toBeTruthy()
    expect(screen.getByText(/provider not found/)).toBeTruthy()
  })

  it("says there is nothing to show without an id", () => {
    renderPage(ProviderDetailPage, scriptedClient({}).client, {})
    expect(screen.getByRole("status").textContent).toMatch(/No provider ID/)
  })
})
