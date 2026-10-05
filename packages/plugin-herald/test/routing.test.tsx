import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { RoutingPage, VIA_TEXT } from "../src/pages/routing"
import { engine, providerSummary, scopeRule } from "./data"
import { invalidatingClient, renderPage, scriptedClient } from "./harness"

const SMTP = providerSummary()
const TWILIO = providerSummary({ id: "hpvd_01j00000000000000000000002", name: "Twilio", channel: "sms", driver: "twilio" })
const DEAD = "hpvd_01j00000000000000000000007"

const RULES = {
  rules: [
    scopeRule(),
    scopeRule({ id: "hscf_01j00000000000000000004001", scope: "org", scopeId: "org_acme", providers: { email: { id: DEAD, dangling: true } }, fromEmail: undefined, fromName: "Acme", defaultLocale: undefined }),
    scopeRule({ id: "hscf_01j00000000000000000004002", scope: "user", scopeId: "usr_ada", providers: { sms: { id: TWILIO.id, name: "Twilio", dangling: false } }, fromEmail: undefined, fromName: undefined, defaultLocale: undefined }),
  ],
}

const resolve = (p: Record<string, unknown>) =>
  p.channel === "push"
    ? { provider: null, via: "none", from: {} }
    : { provider: { id: SMTP.id, name: "Primary SMTP", driver: "smtp", enabled: false }, via: p.orgId ? "org" : "app", from: { email: "hello@example.com", name: "Example" } }

function setup(commands: Record<string, (p: Record<string, unknown>) => unknown> = {}) {
  return scriptedClient(
    { "engine.info": engine(), "scopes.list": RULES, "providers.list": { providers: [SMTP, TWILIO] }, "send.resolve": resolve },
    { "scopes.set": (p) => ({ rule: scopeRule({ scope: p.scope as "app" }) }), "scopes.delete": () => ({ ok: true, id: "x" }), ...commands },
  )
}

/** The command answers after it has invalidated, but only once `release` runs: the page is looking at its refetch while the command is in flight. */
function gated<T extends { client: { command: (intent: string, payload?: unknown) => Promise<unknown> } }>(base: T) {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const client = {
    ...base.client,
    command: async (intent: string, payload?: unknown) => {
      const out = await base.client.command(intent, payload)
      await gate
      return out
    },
  } as T["client"]
  return { client, release }
}

const SCOPE_WRITE = ["scopes.list", "send.resolve", "providers.detail"]

describe("RoutingPage", () => {
  it("groups rules by level, names providers, and flags a deleted one", async () => {
    renderPage(RoutingPage, setup().client)
    expect(await screen.findByRole("heading", { name: "App rule" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Org rules" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "User rules" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Primary SMTP" }).getAttribute("href")).toBe(`/providers/${SMTP.id}`)
    expect(screen.getByText("Provider deleted", { selector: '[data-slot="badge"]' }).getAttribute("data-variant")).toBe("destructive")
    expect(screen.getByText(DEAD).className).toMatch(/font-mono text-xs/)
    expect(screen.getByText("org_acme").className).toMatch(/font-mono text-xs/)
  })

  it("names the app on every state, loading and failed included", async () => {
    const { client } = scriptedClient({ "engine.info": engine(), "scopes.list": () => new ContractError("INTERNAL", "boom"), "providers.list": { providers: [] } })
    renderPage(RoutingPage, client)
    expect(await screen.findByText(/boom/)).toBeTruthy()
    expect(screen.getByRole("heading", { level: 1, name: "Routing" })).toBeTruthy()
    expect((await screen.findByText("app_demo")).className).toMatch(/font-mono text-xs/)
    expect(screen.getByRole("heading", { name: "Who sends?" })).toBeTruthy()
  })

  it("labels the stored default locale as unused", async () => {
    renderPage(RoutingPage, setup().client)
    expect(await screen.findByText(/Send doesn't use it/)).toBeTruthy()
  })

  it("asks who sends for the channel you pick, with the org and user you give, and says why", async () => {
    const c = setup()
    renderPage(RoutingPage, c.client)
    fireEvent.change(await screen.findByLabelText("Channel to test"), { target: { value: "email" } })
    fireEvent.change(screen.getByLabelText("Org ID (optional)"), { target: { value: "org_acme" } })
    expect(await screen.findByText(VIA_TEXT.org)).toBeTruthy()
    expect(c.queried.filter((q) => q.intent === "send.resolve").map((q) => q.params)).toContainEqual({ channel: "email", orgId: "org_acme" })
    expect(screen.getByText("Provider disabled", { selector: '[data-slot="badge"]' })).toBeTruthy()
  })

  it("gives each reason as a sentence of its own, and the fallback one when no rule names a provider", async () => {
    const c = scriptedClient(
      { "engine.info": engine(), "scopes.list": RULES, "providers.list": { providers: [SMTP, TWILIO] }, "send.resolve": () => ({ provider: { id: SMTP.id, name: "Primary SMTP", driver: "smtp", enabled: true }, via: "fallback", from: {} }) },
      {},
    )
    renderPage(RoutingPage, c.client)
    fireEvent.change(await screen.findByLabelText("Channel to test"), { target: { value: "email" } })
    expect(await screen.findByText(VIA_TEXT.fallback)).toBeTruthy()
    expect(screen.queryByText(/Picked by/)).toBeNull()
    expect(VIA_TEXT.fallback).toBe("No rule names one, so Herald takes the first enabled provider for the channel by priority.")
    for (const sentence of Object.values(VIA_TEXT)) expect(sentence).toMatch(/^[A-Z].*\.$/)
  })

  it("leaves an empty org and user out of the question rather than sending them blank", async () => {
    const c = setup()
    renderPage(RoutingPage, c.client)
    fireEvent.change(await screen.findByLabelText("Channel to test"), { target: { value: "email" } })
    await screen.findByText(VIA_TEXT.app)
    expect(c.queried.filter((q) => q.intent === "send.resolve").map((q) => q.params)).toEqual([{ channel: "email" }])
  })

  it("asks nothing until a channel is chosen", async () => {
    const c = setup()
    renderPage(RoutingPage, c.client)
    await screen.findByRole("heading", { name: "App rule" })
    expect(c.queried.some((q) => q.intent === "send.resolve")).toBe(false)
  })

  it("says plainly when nothing would send", async () => {
    renderPage(RoutingPage, setup().client)
    fireEvent.change(await screen.findByLabelText("Channel to test"), { target: { value: "push" } })
    expect(await screen.findByText(/Nothing would send it/)).toBeTruthy()
  })

  it("adds an org rule with only the fields you set", async () => {
    const c = setup()
    renderPage(RoutingPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Add a rule" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Level"), { target: { value: "org" } })
    fireEvent.change(within(dialog).getByLabelText("Org ID"), { target: { value: "org_beta" } })
    fireEvent.change(within(dialog).getByLabelText("email provider"), { target: { value: SMTP.id } })
    fireEvent.change(within(dialog).getByLabelText("From name"), { target: { value: "Beta" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "scopes.set", payload: { scope: "org", scopeId: "org_beta", emailProviderId: SMTP.id, fromName: "Beta" } }]))
  })

  it("will not save an org or user rule without an ID", async () => {
    const c = setup()
    renderPage(RoutingPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Add a rule" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Level"), { target: { value: "user" } })
    expect((within(dialog).getByRole("button", { name: "Save rule" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText("User ID"), { target: { value: "usr_x" } })
    expect((within(dialog).getByRole("button", { name: "Save rule" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("clears a deleted provider's slot when you edit its rule, so the save goes through", async () => {
    const c = setup()
    renderPage(RoutingPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Edit the org rule for org_acme" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/was deleted. Saving clears it/)).toBeTruthy()
    expect((within(dialog).getByLabelText("email provider") as HTMLSelectElement).value).toBe("")
    fireEvent.change(within(dialog).getByLabelText("From name"), { target: { value: "Acme Inc" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))
    await waitFor(() => expect(c.sent).toHaveLength(1))
    expect(c.sent[0]?.payload).toEqual({ scope: "org", scopeId: "org_acme", emailProviderId: "", fromName: "Acme Inc" })
  })

  it("stops saying saving clears the slot once you pick a replacement", async () => {
    renderPage(RoutingPage, setup().client)
    fireEvent.click(await screen.findByRole("button", { name: "Edit the org rule for org_acme" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/Saving clears it/)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText("email provider"), { target: { value: SMTP.id } })
    expect(within(dialog).queryByText(/Saving clears it/)).toBeNull()
  })

  it("flags a rule's provider that is disabled, on the card and in the dialog's options", async () => {
    const off = providerSummary({ id: "hpvd_01j00000000000000000000009", name: "Old SMTP", enabled: false })
    const rules = { rules: [scopeRule({ providers: { email: { id: off.id, name: "Old SMTP", dangling: false }, sms: { id: TWILIO.id, name: "Twilio", dangling: false } } })] }
    const c = scriptedClient({ "engine.info": engine(), "scopes.list": rules, "providers.list": { providers: [SMTP, TWILIO, off] } })
    renderPage(RoutingPage, c.client)
    const link = await screen.findByRole("link", { name: "Old SMTP" })
    expect(within(link.parentElement!).getByText("Provider disabled", { selector: '[data-slot="badge"]' })).toBeTruthy()
    expect(within(screen.getByRole("link", { name: "Twilio" }).parentElement!).queryByText("Provider disabled")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Edit the app rule" }))
    const dialog = await screen.findByRole("dialog")
    const options = Array.from((within(dialog).getByLabelText("email provider") as HTMLSelectElement).options).map((o) => o.textContent)
    expect(options).toContain("Old SMTP (disabled)")
    expect(options).toContain("Primary SMTP")
  })

  it("still shows a stored provider when the provider list failed, and leaves it out of a save that does not touch it", async () => {
    const rules = { rules: [scopeRule({ providers: { sms: { id: TWILIO.id, name: "Twilio", dangling: false } } })] }
    const c = scriptedClient(
      { "engine.info": engine(), "scopes.list": rules, "providers.list": () => new ContractError("INTERNAL", "providers down"), "send.resolve": resolve },
      { "scopes.set": () => ({ rule: scopeRule() }) },
    )
    renderPage(RoutingPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Edit the app rule" }))
    const dialog = await screen.findByRole("dialog")
    const sms = within(dialog).getByLabelText("sms provider") as HTMLSelectElement
    expect(sms.value).toBe(TWILIO.id)
    expect(sms.options[sms.selectedIndex]?.textContent).toBe("Twilio")
    expect(within(dialog).getByText(/providers down/)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText("From name"), { target: { value: "Changed" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))
    await waitFor(() => expect(c.sent).toHaveLength(1))
    expect(c.sent[0]?.payload).toEqual({ scope: "app", fromName: "Changed" })
  })

  it("saves a deleted-provider rule the way the server accepts it: no slot left naming the deleted provider", async () => {
    // The server re-checks every slot of the merged rule, so a payload that
    // omits a dangling slot is refused. Model that check.
    const c = setup({
      "scopes.set": (p) => (p.emailProviderId === "" ? { rule: scopeRule({ scope: "org" }) } : new ContractError("BAD_REQUEST", `herald: invalid provider: email_provider_id "${DEAD}" is not a email provider of this app`)),
    })
    renderPage(RoutingPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Edit the org rule for org_acme" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("From name"), { target: { value: "Acme Inc" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("edits the app rule without a scope ID, sending only what changed", async () => {
    const c = setup()
    renderPage(RoutingPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Edit the app rule" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("sms provider"), { target: { value: TWILIO.id } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))
    await waitFor(() => expect(c.sent).toHaveLength(1))
    expect(c.sent[0]?.payload).toEqual({ scope: "app", smsProviderId: TWILIO.id })
  })

  it("shows a refusal inside the dialog and keeps it open", async () => {
    const c = setup({ "scopes.set": () => new ContractError("BAD_REQUEST", 'herald: invalid provider: sms_provider_id "x" is not a sms provider of this app') })
    renderPage(RoutingPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Edit the app rule" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("From name"), { target: { value: "X" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))
    expect((await within(dialog).findByRole("alert")).textContent).toContain("is not a sms provider")
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("starts each opening from the rule as stored, with no draft or error left over", async () => {
    const c = setup({ "scopes.set": () => new ContractError("BAD_REQUEST", "nope") })
    renderPage(RoutingPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Edit the app rule" }))
    let dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("From name"), { target: { value: "Scratch" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))
    await within(dialog).findByRole("alert")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Edit the app rule" }))
    dialog = await screen.findByRole("dialog")
    expect((within(dialog).getByLabelText("From name") as HTMLInputElement).value).toBe("Example")
    expect(within(dialog).queryByRole("alert")).toBeNull()
  })

  it("deletes a rule behind a confirm, by level and ID", async () => {
    const c = setup()
    renderPage(RoutingPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Delete the user rule for usr_ada" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toMatch(/usr_ada/)
    expect(c.sent).toEqual([])
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "scopes.delete", payload: { scope: "user", scopeId: "usr_ada" } }]))
  })

  it("deletes the app rule by level alone", async () => {
    const c = setup()
    renderPage(RoutingPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Delete the app rule" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "scopes.delete", payload: { scope: "app" } }]))
  })

  it("keeps a delete's failure inside its confirm", async () => {
    const c = setup({ "scopes.delete": () => new ContractError("NOT_FOUND", "routing rule not found") })
    renderPage(RoutingPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Delete the user rule for usr_ada" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect((await within(dialog).findByRole("alert")).textContent).toContain("routing rule not found")
  })

  it("keeps the edit dialog up while the rules refetch, even when the refetch fails, then closes it", async () => {
    const base = invalidatingClient(
      {
        "engine.info": engine(),
        "scopes.list": (_input, call) => (call === 0 ? RULES : new ContractError("INTERNAL", "refetch failed")),
        "providers.list": { providers: [SMTP, TWILIO] },
        "send.resolve": resolve,
      },
      { "scopes.set": { answer: { rule: scopeRule() }, invalidates: SCOPE_WRITE } },
    )
    const { client, release } = gated(base)
    renderPage(RoutingPage, client)
    fireEvent.click(await screen.findByRole("button", { name: "Edit the org rule for org_acme" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("From name"), { target: { value: "Acme Inc" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rule" }))
    await waitFor(() => expect(base.queried.filter((q) => q.intent === "scopes.list")).toHaveLength(2))
    await screen.findByText(/refetch failed/)
    // The rules behind it are gone, but the dialog, its draft and its words are not.
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect((within(screen.getByRole("dialog")).getByLabelText("From name") as HTMLInputElement).value).toBe("Acme Inc")
    expect(within(screen.getByRole("dialog")).getByText(/was deleted. Saving clears it/)).toBeTruthy()
    release()
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(base.sent).toEqual([{ intent: "scopes.set", payload: { scope: "org", scopeId: "org_acme", emailProviderId: "", fromName: "Acme Inc" } }])
  })

  it("keeps the delete confirm up, naming its rule, while the rules refetch, then closes it", async () => {
    const base = invalidatingClient(
      {
        "engine.info": engine(),
        "scopes.list": (_input, call) => (call === 0 ? RULES : new ContractError("INTERNAL", "refetch failed")),
        "providers.list": { providers: [SMTP, TWILIO] },
        "send.resolve": resolve,
      },
      { "scopes.delete": { answer: { ok: true, id: "x" }, invalidates: SCOPE_WRITE } },
    )
    const { client, release } = gated(base)
    renderPage(RoutingPage, client)
    fireEvent.click(await screen.findByRole("button", { name: "Delete the user rule for usr_ada" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(base.queried.filter((q) => q.intent === "scopes.list")).toHaveLength(2))
    await screen.findByText(/refetch failed/)
    expect(screen.getByRole("alertdialog").textContent).toMatch(/usr_ada/)
    release()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(base.sent).toEqual([{ intent: "scopes.delete", payload: { scope: "user", scopeId: "usr_ada" } }])
  })
})
