import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ProviderEditPage } from "../src/pages/provider-edit"
import { engine, providerDetail, providerSummary } from "./data"
import { expectNotInReactState } from "./canary"
import { invalidatingClient, renderWithNavigate, renderPage, scriptedClient } from "./harness"

const CANARY = "sk_live_canary_edit"
const ID = "hpvd_01j00000000000000000000001"

function setup(onUpdate: (input: Record<string, unknown>) => unknown = () => ({ provider: providerSummary() })) {
  const c = scriptedClient({ "engine.info": engine(), "providers.detail": { provider: providerDetail() } }, { "providers.update": onUpdate })
  const view = renderWithNavigate(ProviderEditPage, c.client, { id: ID })
  return { ...c, ...view }
}

function expectCanaryNowhere() {
  expect(document.body.innerHTML).not.toContain(CANARY)
  for (const input of document.querySelectorAll("input[type=password]")) expect(input.hasAttribute("value")).toBe(false)
  expectNotInReactState(document.body.firstElementChild as HTMLElement, CANARY)
}

function credentialRow(key: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(key, { selector: "td *, td" }))!
}

describe("ProviderEditPage", () => {
  it("prefills what it can read and shows credentials by protection only", async () => {
    setup()
    expect(((await screen.findByLabelText("Name")) as HTMLInputElement).value).toBe("Primary SMTP")
    expect((screen.getByLabelText("Host") as HTMLInputElement).value).toBe("smtp.example.com")
    const row = credentialRow("password")
    expect(within(row).getByText("Encrypted", { selector: '[data-slot="badge"]' })).toBeTruthy()
    expect(within(row).getByRole("button", { name: "Replace password" })).toBeTruthy()
    expect(within(row).queryByRole("button", { name: /show/i })).toBeNull()
    expect(document.querySelectorAll("input[type=password]")).toHaveLength(0)
  })

  it("holds Save until something changed", async () => {
    setup()
    expect(((await screen.findByRole("button", { name: "Save changes" })) as HTMLButtonElement).disabled).toBe(true)
  })

  it("replaces one credential and sends only that", async () => {
    const { sent, navigate, queried } = setup()
    fireEvent.click(await screen.findByRole("button", { name: "Replace password" }))
    const input = screen.getByLabelText("New value for password") as HTMLInputElement
    expect(input.type).toBe("password")
    fireEvent.change(input, { target: { value: CANARY } })
    expectCanaryNowhere()
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.payload).toEqual({ id: ID, setCredentials: { password: CANARY } })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/providers/${ID}`))
    expect(input.value).toBe("")
    expectCanaryNowhere()
    expect(JSON.stringify(queried)).not.toContain(CANARY)
  })

  it("removes a credential by key", async () => {
    const { sent } = setup()
    fireEvent.click(await screen.findByRole("button", { name: "Remove username" }))
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.payload).toEqual({ id: ID, removeCredentials: ["username"] })
  })

  it("removes a setting you empty, and sends a changed one", async () => {
    const { sent } = setup()
    fireEvent.change(await screen.findByLabelText("From address"), { target: { value: "" } })
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "465" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.payload).toEqual({ id: ID, setSettings: { port: "465" }, removeSettings: ["from"] })
  })

  it("asks for the secrets again before moving the host, then sends both", async () => {
    const { sent } = setup()
    fireEvent.change(await screen.findByLabelText("Host"), { target: { value: "smtp.elsewhere.test" } })
    expect(screen.getByText(/Changing host sends credentials to a new server/)).toBeTruthy()
    expect(screen.getByText(/enter password again/)).toBeTruthy()
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Replace password" }))
    fireEvent.change(screen.getByLabelText("New value for password"), { target: { value: CANARY } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.payload).toEqual({ id: ID, setSettings: { host: "smtp.elsewhere.test" }, setCredentials: { password: CANARY } })
  })

  it("keeps a replaced secret in its field on failure and out of the markup", async () => {
    setup(() => new ContractError("UNAVAILABLE", "this provider's credentials are encrypted under a key this server doesn't have"))
    fireEvent.click(await screen.findByRole("button", { name: "Replace password" }))
    const input = screen.getByLabelText("New value for password") as HTMLInputElement
    fireEvent.change(input, { target: { value: CANARY } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect((await screen.findByRole("alert")).textContent).toContain("encrypted under a key")
    expect(input.value).toBe(CANARY)
    expectCanaryNowhere()
  })

  it("keeps a replaced secret on CONFLICT, and a retry sends it again", async () => {
    const { sent } = setup(() => new ContractError("CONFLICT", "herald: provider was changed by someone else"))
    fireEvent.click(await screen.findByRole("button", { name: "Replace password" }))
    const input = screen.getByLabelText("New value for password") as HTMLInputElement
    fireEvent.change(input, { target: { value: CANARY } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("CONFLICT")
    expect(input.value).toBe(CANARY)
    expectCanaryNowhere()
    await waitFor(() => expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1]?.payload).toEqual({ id: ID, setCredentials: { password: CANARY } })
  })

  it("drops a half-typed replacement when you press Keep, so the move guard cannot count it", async () => {
    const { sent } = setup()
    fireEvent.change(await screen.findByLabelText("Host"), { target: { value: "smtp.elsewhere.test" } })
    fireEvent.click(screen.getByRole("button", { name: "Replace password" }))
    fireEvent.change(screen.getByLabelText("New value for password"), { target: { value: CANARY } })
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Keep" }))
    expect(screen.queryByLabelText("New value for password")).toBeNull()
    expect(save.disabled).toBe(true)
    expect(screen.getByText(/enter password again/)).toBeTruthy()
    expect(sent).toEqual([])
    expectCanaryNowhere()
  })

  it("lets the move through when the stored secret is removed instead", async () => {
    const { sent } = setup()
    fireEvent.change(await screen.findByLabelText("Host"), { target: { value: "smtp.elsewhere.test" } })
    fireEvent.click(screen.getByRole("button", { name: "Remove password" }))
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.payload).toEqual({ id: ID, setSettings: { host: "smtp.elsewhere.test" }, removeCredentials: ["password"] })
  })

  it("keeps the form and its typed secret while the save's own refetch of the provider is in flight", async () => {
    const detail = (_input: Record<string, unknown>, call: number) => ({ provider: providerDetail({ name: call === 0 ? "Primary SMTP" : "Primary SMTP (refetched)" }) })
    const { client: base, queried, sent } = invalidatingClient(
      { "engine.info": engine(), "providers.detail": detail },
      { "providers.update": { answer: { provider: providerSummary() }, invalidates: ["providers.list", "providers.detail", "overview.stats", "send.resolve", "scopes.list"] } },
    )
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
    const { navigate } = renderWithNavigate(ProviderEditPage, client, { id: ID })
    fireEvent.click(await screen.findByRole("button", { name: "Replace password" }))
    const input = screen.getByLabelText("New value for password") as HTMLInputElement
    fireEvent.change(input, { target: { value: CANARY } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(queried.filter((q) => q.intent === "providers.detail")).toHaveLength(2))
    expect(sent).toHaveLength(1)
    // The same input, with the same typed value: not remounted empty.
    expect(screen.getByLabelText("New value for password")).toBe(input)
    expect(input.value).toBe(CANARY)
    expect(navigate).not.toHaveBeenCalled()
    release()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/providers/${ID}`))
    expect(input.value).toBe("")
    expectCanaryNowhere()
  })

  it("names the app, and says why there is nothing to edit, when the address has no ID", () => {
    const c = scriptedClient({ "engine.info": engine() })
    renderPage(ProviderEditPage, c.client, {})
    expect(screen.getByText("No provider ID in the address, so there is nothing to edit.")).toBeTruthy()
    expect(screen.getByRole("heading", { level: 1, name: "Edit provider" })).toBeTruthy()
    expect(c.queried.find((q) => q.intent === "providers.detail")).toBeUndefined()
  })

  it("keeps the header while the provider loads and when it is not found", async () => {
    const c = scriptedClient({ "engine.info": engine(), "providers.detail": () => new ContractError("NOT_FOUND", "provider not found") })
    renderPage(ProviderEditPage, c.client, { id: ID })
    expect(screen.getByRole("heading", { level: 1, name: "Edit provider" })).toBeTruthy()
    expect(await screen.findByText(/Provider unavailable/)).toBeTruthy()
    expect(screen.getByRole("heading", { level: 1, name: "Edit provider" })).toBeTruthy()
    expect(await screen.findByText("app_demo")).toBeTruthy()
  })

  it("counts the stored credentials in the table caption", async () => {
    setup()
    expect(await screen.findByRole("table", { name: "2 stored credentials" })).toBeTruthy()
  })

  it("holds Save for a driver with no schema until every stored credential is entered again or removed", async () => {
    const legacy = providerDetail({
      id: "hpvd_01j00000000000000000000005",
      name: "Legacy gateway",
      channel: "sms",
      driver: "legacy-sms",
      credentials: [
        { key: "token", protection: "aes-256-gcm", keyId: "k1" },
        { key: "user", protection: "plaintext" },
      ],
      settings: [{ key: "base_url", secret: true }],
    })
    const c = scriptedClient({ "engine.info": engine(), "providers.detail": { provider: legacy } }, { "providers.update": () => ({ provider: providerSummary() }) })
    renderWithNavigate(ProviderEditPage, c.client, { id: legacy.id })
    // base_url is stored as a hidden value here: replacing it moves where credentials go.
    fireEvent.click(await screen.findByRole("button", { name: "Replace base_url" }))
    fireEvent.change(screen.getByLabelText("New value for base_url"), { target: { value: "https://elsewhere.test" } })
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(screen.getByText(/Changing base_url sends credentials to a new server/)).toBeTruthy()
    expect(screen.getByText(/enter token, user again/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Replace token" }))
    fireEvent.change(screen.getByLabelText("New value for token"), { target: { value: CANARY } })
    expect(save.disabled).toBe(true)
    expect(screen.getByText(/enter user again/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Remove user" }))
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(c.sent).toHaveLength(1))
    expect(c.sent[0]?.payload).toEqual({ id: legacy.id, setSettings: { base_url: "https://elsewhere.test" }, setCredentials: { token: CANARY }, removeCredentials: ["user"] })
  })
})
