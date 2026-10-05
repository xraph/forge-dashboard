import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { SendTestPage } from "../src/pages/send-test"
import type { SendTestResponse } from "../src/wire"
import { engine, messageDetail, providerDetail, providerSummary, templateDetail, templateSummary } from "./data"
import { invalidatingClient, renderPage, scriptedClient } from "./harness"

const SMTP = providerSummary()
const TWILIO = providerSummary({ id: "hpvd_01j00000000000000000000002", name: "Twilio", channel: "sms", driver: "twilio" })
const MESSAGE = "hmsg_01j00000000000000000001000"
const RENDERED = {
  fields: [
    { field: "subject", output: "Your $12 receipt", rendered: true },
    { field: "html", output: "<p>Thanks Ada</p>", rendered: true },
    { field: "text", output: "Thanks Ada", rendered: true },
    { field: "title", output: "", rendered: false },
  ],
  diagnostics: [],
}
const ACCEPTED: SendTestResponse = { messageId: "hmsg_01j00000000000000000000150", status: "sent", provider: { id: SMTP.id, name: "Primary SMTP", driver: "smtp" }, providerMessageId: "test@smtp.example.com", logged: true }
const SEND_INVALIDATES = ["messages.list", "messages.detail", "overview.stats", "inbox.list"]

function queries(resolveEnabled = true) {
  return {
    "engine.info": engine(),
    "providers.list": (p: Record<string, unknown>) => ({ providers: [SMTP, TWILIO].filter((x) => x.channel === p.channel) }),
    "providers.detail": { provider: providerDetail() },
    "templates.list": (p: Record<string, unknown>) => ({ templates: p.channel === "email" ? [templateSummary()] : [] }),
    "templates.detail": { template: templateDetail(), resolution: [] },
    "templates.resolve": { locale: "en", steps: [{ try: "en", match: "exact", found: true, versionId: "htpv_01j00000000000000000000026" }], versionId: "htpv_01j00000000000000000000026", match: "exact" },
    "templates.render": RENDERED,
    "messages.detail": { message: messageDetail({ template: { id: "htpl_01j00000000000000000000015", slug: "billing.receipt", channel: "email" } }) },
    "send.resolve": (p: Record<string, unknown>) =>
      p.channel === "push"
        ? { provider: null, via: "none", from: {} }
        : p.providerId
          ? { provider: { id: String(p.providerId), name: p.channel === "sms" ? "Twilio" : "Primary SMTP", driver: p.channel === "sms" ? "twilio" : "smtp", enabled: true }, via: "chosen", from: {} }
          : { provider: { id: SMTP.id, name: "Primary SMTP", driver: "smtp", enabled: resolveEnabled }, via: "app", from: { email: "hello@example.com", name: "Example" } },
  }
}

function setup(answer: SendTestResponse | (() => unknown) = ACCEPTED, resolveEnabled = true) {
  return scriptedClient(queries(resolveEnabled), { "send.test": typeof answer === "function" ? answer : () => answer })
}

async function fillVariables() {
  fireEvent.change(await screen.findByLabelText("customer_name"), { target: { value: "Ada" } })
  fireEvent.change(screen.getByLabelText("amount"), { target: { value: "$12" } })
}

async function fillTemplateSend() {
  fireEvent.change(await screen.findByLabelText("Channel"), { target: { value: "email" } })
  fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: "ada@example.com" } })
  fireEvent.change(await screen.findByLabelText("Template"), { target: { value: "htpl_01j00000000000000000000015" } })
  await fillVariables()
}

async function sendAndConfirm() {
  // Send stays held while send.resolve is still answering for what you typed (the user ID settles after a pause).
  await waitFor(() => expect((screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole("button", { name: "Send test" }))
  const dialog = await screen.findByRole("alertdialog")
  fireEvent.click(within(dialog).getByRole("button", { name: "Send" }))
  return dialog
}

async function rawEmail(who = "ada@example.com") {
  fireEvent.change(await screen.findByLabelText("Channel"), { target: { value: "email" } })
  fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: who } })
  fireEvent.change(screen.getByLabelText("Content"), { target: { value: "raw" } })
  fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Hi" } })
}

describe("SendTestPage", () => {
  it("names the provider Herald would pick, and why, when you leave it to Herald", async () => {
    renderPage(SendTestPage, setup().client)
    fireEvent.change(await screen.findByLabelText("Channel"), { target: { value: "email" } })
    expect(await screen.findByText(/The app's routing rule names it\./)).toBeTruthy()
    expect(screen.queryByText(/picked by/)).toBeNull()
    fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: "ada@example.com" } })
    fireEvent.change(await screen.findByLabelText("Content"), { target: { value: "raw" } })
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Hi" } })
    fireEvent.click(screen.getByRole("button", { name: "Send test" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toMatch(/real email message to ada@example.com through Primary SMTP \(smtp\)/)
  })

  it("says the picked provider is disabled before you send", async () => {
    renderPage(SendTestPage, setup(undefined, false).client)
    fireEvent.change(await screen.findByLabelText("Channel"), { target: { value: "email" } })
    expect(await screen.findByText("Provider disabled", { selector: '[data-slot="badge"]' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: "ada@example.com" } })
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "raw" } })
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Hi" } })
    fireEvent.click(screen.getByRole("button", { name: "Send test" }))
    expect((await screen.findByRole("alertdialog")).textContent).toMatch(/which is disabled/)
  })

  it("pins the provider it was opened for", async () => {
    renderPage(SendTestPage, setup().client, { providerId: "hpvd_01j00000000000000000000001" })
    expect(((await screen.findByLabelText("Channel")) as HTMLSelectElement).value).toBe("email")
    await waitFor(() => expect((screen.getByLabelText("Provider") as HTMLSelectElement).value).toBe("hpvd_01j00000000000000000000001"))
    expect(await screen.findByText(/It was chosen explicitly\./)).toBeTruthy()
  })

  it("names the pinned provider in the confirm", async () => {
    const c = setup()
    renderPage(SendTestPage, c.client, { providerId: "hpvd_01j00000000000000000000001" })
    await waitFor(() => expect((screen.getByLabelText("Provider") as HTMLSelectElement).value).toBe("hpvd_01j00000000000000000000001"))
    fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: "ada@example.com" } })
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "raw" } })
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Hi" } })
    await screen.findByText(/It was chosen explicitly\./)
    fireEvent.click(screen.getByRole("button", { name: "Send test" }))
    expect((await screen.findByRole("alertdialog")).textContent).toMatch(/through Primary SMTP \(smtp\)\./)
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Send" }))
    await waitFor(() => expect(c.sent).toHaveLength(1))
    expect(c.sent[0]?.payload).toEqual({ channel: "email", recipient: "ada@example.com", providerId: "hpvd_01j00000000000000000000001", body: "Hi" })
  })

  it("prefills channel, recipient and template from a message", async () => {
    renderPage(SendTestPage, setup().client, { messageId: MESSAGE })
    expect(((await screen.findByLabelText("Recipient")) as HTMLInputElement).value).toBe("ada@example.com")
    expect((screen.getByLabelText("Channel") as HTMLSelectElement).value).toBe("email")
    await waitFor(() => expect((screen.getByLabelText("Template") as HTMLSelectElement).value).toBe("htpl_01j00000000000000000000015"))
  })

  it("shows the app line and the real-message warning on every state", async () => {
    renderPage(SendTestPage, scriptedClient({ "engine.info": new ContractError("INTERNAL", "boom") }).client)
    expect(screen.getByRole("heading", { level: 1, name: "Send test" })).toBeTruthy()
    expect(screen.getByText(/Sends a real message to a real recipient/)).toBeTruthy()
    expect(await screen.findByText(/App unknown/)).toBeTruthy()
  })

  it("shows the rendered preview of the version that will answer", async () => {
    renderPage(SendTestPage, setup().client)
    await fillTemplateSend()
    expect(await screen.findByText("Your $12 receipt")).toBeTruthy()
    expect(screen.getByTitle("Rendered email").getAttribute("sandbox")).toBe("")
  })

  it("shows the render error beside a stale preview", async () => {
    const c = scriptedClient({ ...queries(), "templates.render": (p) => (JSON.stringify(p).includes("$12") ? new ContractError("BAD_REQUEST", "herald: template syntax: unexpected }}") : RENDERED) }, { "send.test": ACCEPTED })
    renderPage(SendTestPage, c.client)
    fireEvent.change(await screen.findByLabelText("Channel"), { target: { value: "email" } })
    fireEvent.change(await screen.findByLabelText("Template"), { target: { value: "htpl_01j00000000000000000000015" } })
    await screen.findByLabelText("customer_name")
    expect(await screen.findByText("Your $12 receipt")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("amount"), { target: { value: "$12" } })
    expect(await screen.findByText(/unexpected }}/)).toBeTruthy()
    expect(screen.getByText(/Out of date/)).toBeTruthy()
  })

  it("sends the template by slug with its locale and the variables you filled", async () => {
    const c = setup()
    renderPage(SendTestPage, c.client)
    await fillTemplateSend()
    await sendAndConfirm()
    await waitFor(() => expect(c.sent).toHaveLength(1))
    expect(c.sent[0]).toEqual({ intent: "send.test", payload: { channel: "email", recipient: "ada@example.com", template: "billing.receipt", locale: "en", data: { customer_name: "Ada", amount: "$12" } } })
  })

  it("sends a raw body without template fields", async () => {
    const c = setup()
    renderPage(SendTestPage, c.client)
    fireEvent.change(await screen.findByLabelText("Channel"), { target: { value: "sms" } })
    fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: "+15550111" } })
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "raw" } })
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Hello" } })
    await sendAndConfirm()
    await waitFor(() => expect(c.sent).toHaveLength(1))
    expect(c.sent[0]?.payload).toEqual({ channel: "sms", recipient: "+15550111", body: "Hello" })
  })

  it("never sends a template and a raw body together, even after switching between them", async () => {
    const c = setup()
    renderPage(SendTestPage, c.client)
    await fillTemplateSend()
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "raw" } })
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Hello" } })
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Hi" } })
    await sendAndConfirm()
    await waitFor(() => expect(c.sent).toHaveLength(1))
    expect(c.sent[0]?.payload).toEqual({ channel: "email", recipient: "ada@example.com", subject: "Hello", body: "Hi" })
  })

  it("reports an accepted send without claiming delivery, with the vendor ID and a link to the log", async () => {
    renderPage(SendTestPage, setup().client)
    await fillTemplateSend()
    await sendAndConfirm()
    expect(await screen.findByText(/Accepted by Primary SMTP/)).toBeTruthy()
    expect(screen.getByText("test@smtp.example.com").className).toMatch(/font-mono text-xs/)
    expect(screen.getByText(/delivery isn't confirmed/)).toBeTruthy()
    expect(screen.queryByText(/delivered/i)).toBeNull()
    expect(screen.getByRole("link", { name: "Open it under Messages" }).getAttribute("href")).toBe("/messages/hmsg_01j00000000000000000000150")
  })

  it("holds the result in a live region that is mounted before the send and holds the result after", async () => {
    const { container } = renderPage(SendTestPage, setup().client)
    await fillTemplateSend()
    const region = container.querySelector("form [aria-live=polite]")
    expect(region).not.toBeNull()
    expect(region!.textContent).toBe("")
    await sendAndConfirm()
    await screen.findByText(/Accepted by Primary SMTP/)
    expect(container.querySelector("form [aria-live=polite]")).toBe(region)
    expect(region!.textContent).toMatch(/Accepted by Primary SMTP/)
  })

  it("shows a provider failure as a result with the provider's own words, not an error banner", async () => {
    renderPage(SendTestPage, setup({ messageId: "hmsg_01j00000000000000000000151", status: "failed", provider: { id: SMTP.id, name: "Primary SMTP", driver: "smtp" }, error: "smtp: 535 authentication failed", logged: true }).client)
    await fillTemplateSend()
    await sendAndConfirm()
    const pre = await screen.findByText("smtp: 535 authentication failed")
    expect(pre.tagName).toBe("PRE")
    expect(screen.getByText(/It failed \(Primary SMTP\)\. The error Herald recorded:/)).toBeTruthy()
    expect(screen.queryByText(/refused it|Its own words/)).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("explains a suppressed send and an unlogged one", async () => {
    renderPage(SendTestPage, setup({ messageId: "hmsg_01j00000000000000000000152", status: "suppressed", provider: null, error: "user opted out", logged: false }).client)
    await fillTemplateSend()
    fireEvent.change(screen.getByLabelText("User ID (optional)"), { target: { value: "usr_ada" } })
    await sendAndConfirm()
    const note = await screen.findByText((_, el) => el?.tagName === "P" && /^Not sent: usr_ada opted out of billing.receipt on email\.$/.test(el.textContent ?? ""))
    expect(within(note).getByText("usr_ada").className).toMatch(/font-mono text-xs/)
    expect(within(note).getByText("billing.receipt").className).toMatch(/font-mono text-xs/)
    expect(screen.getByText(/won't appear under Messages/)).toBeTruthy()
    expect(screen.queryByText(/Accepted by/)).toBeNull()
    expect(screen.queryByRole("link", { name: "Open it under Messages" })).toBeNull()
  })

  it("says so when Herald sent through a different provider than the confirm named", async () => {
    renderPage(SendTestPage, setup({ ...ACCEPTED, provider: { id: TWILIO.id, name: "Backup SMTP", driver: "smtp" } }).client)
    await fillTemplateSend()
    await sendAndConfirm()
    const note = await screen.findByText(/Routing changed between the check and the send\./)
    expect(note.textContent).toMatch(/Herald sent it through Backup SMTP \(smtp\), not Primary SMTP as the confirm said\./)
    expect(screen.getByText(/Accepted by Backup SMTP/)).toBeTruthy()
  })

  it("does not call it a mismatch when the same provider sent it", async () => {
    renderPage(SendTestPage, setup().client)
    await fillTemplateSend()
    await sendAndConfirm()
    await screen.findByText(/Accepted by Primary SMTP/)
    expect(screen.queryByText(/Routing changed/)).toBeNull()
  })

  it("holds Send while a revisited resolve answer is refetching", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let emailAsks = 0
    const base = queries()
    const c = scriptedClient(
      {
        ...base,
        "send.resolve": async (p: Record<string, unknown>) => {
          if (p.channel === "email" && ++emailAsks === 2) await gate
          return base["send.resolve"](p)
        },
      },
      { "send.test": ACCEPTED },
    )
    renderPage(SendTestPage, c.client)
    await rawEmail()
    await waitFor(() => expect((screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "sms" } })
    await screen.findByText(/Sends through/)
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "email" } })
    // The cached answer for email is back on screen while it reloads; Send must not trust it.
    await waitFor(() => expect(emailAsks).toBe(2))
    expect((screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(true)
    release()
    await waitFor(() => expect((screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(false))
  })

  it("keeps a refusal that never reached a provider inside the dialog", async () => {
    renderPage(SendTestPage, setup(() => new ContractError("BAD_REQUEST", "herald: missing required template variable: amount")).client)
    await fillTemplateSend()
    const dialog = await sendAndConfirm()
    expect((await within(dialog).findByRole("alert")).textContent).toContain("missing required template variable: amount")
  })

  it("holds Send when nothing would send it", async () => {
    renderPage(SendTestPage, setup().client)
    fireEvent.change(await screen.findByLabelText("Channel"), { target: { value: "push" } })
    expect((await screen.findByText(/Nothing would send it/)).textContent).toBe("Nothing would send it: no rule names a usable provider for push, and no enabled provider handles it.")
    fireEvent.change(screen.getByLabelText("Recipient"), { target: { value: "device-token" } })
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "raw" } })
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Hi" } })
    expect((screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("holds Send until send.resolve has answered, and when it fails", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow = scriptedClient({ ...queries(), "send.resolve": async () => (await gate, queries()["send.resolve"]({ channel: "email" })) }, { "send.test": ACCEPTED })
    const first = renderPage(SendTestPage, slow.client)
    await rawEmail()
    expect(screen.getByText(/Asking who would send/)).toBeTruthy()
    expect((screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(true)
    release()
    await waitFor(() => expect((screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(false))
    first.unmount()

    renderPage(SendTestPage, scriptedClient({ ...queries(), "send.resolve": new ContractError("INTERNAL", "routing is down") }, { "send.test": ACCEPTED }).client)
    await rawEmail()
    expect(await screen.findByText(/routing is down/)).toBeTruthy()
    expect((screen.getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(true)
  })

  /**
   * send.test invalidates messages.detail, which the message-prefilled route
   * reads. The result must outlive that refetch, including a refetch that
   * fails, so the form and the confirm live outside the prefill's boundary.
   */
  describe("when send.test refetches the message it was opened from", () => {
    function fromMessage(redetail: (call: number) => unknown) {
      return invalidatingClient(
        { ...queries(), "messages.detail": (_input: Record<string, unknown>, call: number) => redetail(call) },
        { "send.test": { answer: ACCEPTED, invalidates: SEND_INVALIDATES } },
      )
    }
    const original = () => ({ message: messageDetail({ template: { id: "htpl_01j00000000000000000000015", slug: "billing.receipt", channel: "email" } }) })

    async function sendFromMessage(release?: () => void) {
      expect(((await screen.findByLabelText("Recipient")) as HTMLInputElement).value).toBe("ada@example.com")
      await waitFor(() => expect((screen.getByLabelText("Template") as HTMLSelectElement).value).toBe("htpl_01j00000000000000000000015"))
      await fillVariables()
      const dialog = await sendAndConfirm()
      return { dialog, release }
    }

    it("keeps the confirm up while the refetch is in flight, then shows the result", async () => {
      const { client: base, queried } = fromMessage((call) => (call === 0 ? original() : { message: messageDetail({ status: "sent", attempts: 2 }) }))
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
      renderPage(SendTestPage, client, { messageId: MESSAGE })
      await sendFromMessage()
      await waitFor(() => expect(queried.filter((q) => q.intent === "messages.detail")).toHaveLength(2))
      expect(screen.getByRole("alertdialog")).toBeTruthy()
      release()
      expect(await screen.findByText(/Accepted by Primary SMTP/)).toBeTruthy()
      expect(screen.queryByRole("alertdialog")).toBeNull()
    })

    it("keeps the result when the refetch of the message fails", async () => {
      const { client, queried } = fromMessage((call) => (call === 0 ? original() : new ContractError("NOT_FOUND", "message not found")))
      renderPage(SendTestPage, client, { messageId: MESSAGE })
      await sendFromMessage()
      await waitFor(() => expect(queried.filter((q) => q.intent === "messages.detail")).toHaveLength(2))
      expect(await screen.findByText(/Accepted by Primary SMTP/)).toBeTruthy()
      expect(screen.getByRole("link", { name: "Open it under Messages" })).toBeTruthy()
      expect(((screen.getByLabelText("Recipient")) as HTMLInputElement).value).toBe("ada@example.com")
    })
  })
})
