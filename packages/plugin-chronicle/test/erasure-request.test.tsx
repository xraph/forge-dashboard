import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError, PluginProvider, queryStore } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { ErasureRequestDialog } from "../src/components/erasure-request-dialog"
import { scriptedClient } from "./harness"

function renderDialog(client: ScopedClient) {
  return render(
    <PluginProvider client={client}>
      <ErasureRequestDialog open onOpenChange={() => {}} />
    </PluginProvider>,
  )
}

function fill(subject: string, reason: string) {
  fireEvent.change(screen.getByLabelText("Subject ID"), { target: { value: subject } })
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: reason } })
}

describe("ErasureRequestDialog", () => {
  it("counts the subject's events before the confirm button does anything", async () => {
    const c = scriptedClient(
      { "erasures.preview": (p) => ({ subjectId: p.subjectId, eventsAffected: 14 }) },
      { "erasures.request": { id: "erasure_3", subjectId: "subject_1", eventsAffected: 14, keyDestroyed: true, legacyKeyRetained: false } },
    )
    renderDialog(c.client)
    fill("subject_1", "GDPR Article 17 request 5520")
    // Opening the dialog and typing must not count anything: the count is the operator's act.
    expect(c.queried).toEqual([])
    expect(screen.getByRole("button", { name: "Erase" }).hasAttribute("disabled")).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await waitFor(() => expect(screen.getByText(/14 events in your scope/)).toBeTruthy())
    expect(c.queried).toEqual([{ intent: "erasures.preview", params: { subjectId: "subject_1" } }])
    expect(c.sent).toEqual([])
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "erasures.request", payload: { subjectId: "subject_1", reason: "GDPR Article 17 request 5520" } }]))
  })

  it("keeps the dialog open after erasing, and shows the result in place of the count", async () => {
    const c = scriptedClient(
      { "erasures.preview": { subjectId: "subject_1", eventsAffected: 14 } },
      { "erasures.request": { id: "erasure_3", subjectId: "subject_1", eventsAffected: 14, keyDestroyed: true, legacyKeyRetained: false } },
    )
    let closed = false
    render(
      <PluginProvider client={c.client}>
        <ErasureRequestDialog open onOpenChange={(o) => { if (!o) closed = true }} />
      </PluginProvider>,
    )
    fill("subject_1", "r")
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await screen.findByText(/14 events in your scope/)
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))
    await screen.findByText(/14 events erased. The key is destroyed./)
    expect(closed).toBe(false)
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    // The request invalidates the count; a refreshed "0 events will be erased" beside the result would read as a contradiction.
    expect(screen.queryByText(/will have their sealed fields erased/)).toBeNull()
    expect(screen.getByRole("button", { name: "Erase" }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy()
  })

  it("starts empty every time it opens, with no count and no result from the last time", async () => {
    const c = scriptedClient({ "erasures.preview": { subjectId: "s", eventsAffected: 2 } })
    const ui = (open: boolean) => (
      <PluginProvider client={c.client}>
        <ErasureRequestDialog open={open} onOpenChange={() => {}} />
      </PluginProvider>
    )
    const { rerender } = render(ui(true))
    fill("s", "r")
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await screen.findByText(/2 events in your scope/)
    rerender(ui(false))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    rerender(ui(true))
    expect((screen.getByLabelText("Subject ID") as HTMLInputElement).value).toBe("")
    expect((screen.getByLabelText("Reason") as HTMLTextAreaElement).value).toBe("")
    expect(screen.queryByText(/events in your scope will/)).toBeNull()
  })

  it("asks for a fresh count when the subject changes after counting", async () => {
    const c = scriptedClient({ "erasures.preview": (p) => ({ subjectId: p.subjectId, eventsAffected: 3 }) })
    renderDialog(c.client)
    fill("subject_1", "r")
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await screen.findByText(/3 events in your scope/)
    fireEvent.change(screen.getByLabelText("Subject ID"), { target: { value: "subject_2" } })
    expect(screen.getByRole("button", { name: "Erase" }).hasAttribute("disabled")).toBe(true)
  })

  it("says plainly when the key was kept because another scope still uses it", async () => {
    const c = scriptedClient(
      { "erasures.preview": { subjectId: "legacy-user", eventsAffected: 3 } },
      { "erasures.request": { id: "erasure_4", subjectId: "legacy-user", eventsAffected: 3, keyDestroyed: false, legacyKeyRetained: true } },
    )
    renderDialog(c.client)
    fill("legacy-user", "Account closure")
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await screen.findByText(/3 events in your scope/)
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))
    await waitFor(() => expect(screen.getByText(/not yet cryptographic/)).toBeTruthy())
    expect(screen.getByText(/no read path shows their content/)).toBeTruthy()
    expect(screen.queryByText(/failed/i)).toBeNull()
  })

  it("agrees the verb with a single erased event", async () => {
    const c = scriptedClient(
      { "erasures.preview": { subjectId: "s", eventsAffected: 1 } },
      { "erasures.request": { id: "erasure_5", subjectId: "s", eventsAffected: 1, keyDestroyed: false, legacyKeyRetained: true } },
    )
    renderDialog(c.client)
    fill("s", "r")
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await screen.findByText(/1 event in your scope/)
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))
    expect(await screen.findByText(/^1 event is marked erased/)).toBeTruthy()
  })

  it("shows a refusal inside the dialog, where the operator is looking", async () => {
    const c = scriptedClient(
      { "erasures.preview": { subjectId: "s", eventsAffected: 1 } },
      { "erasures.request": new ContractError("PERMISSION_DENIED", "") },
    )
    renderDialog(c.client)
    fill("s", "r")
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await screen.findByText(/1 event in your scope/)
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))
    const dialog = await screen.findByRole("alertdialog")
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("PERMISSION_DENIED"))
  })

  it("shows a failed count inside the dialog and leaves Erase disabled", async () => {
    const c = scriptedClient({ "erasures.preview": new ContractError("BAD_REQUEST", "subjectId is required") })
    renderDialog(c.client)
    fill("s", "r")
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    const dialog = screen.getByRole("alertdialog")
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("BAD_REQUEST"))
    expect(screen.getByRole("button", { name: "Erase" }).hasAttribute("disabled")).toBe(true)
  })

  it("refuses inputs the server would refuse, before sending", () => {
    renderDialog(scriptedClient({}).client)
    fill(" subject_1", "r")
    expect(screen.getByText(/leading or trailing space/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Count affected events" }).hasAttribute("disabled")).toBe(true)
    fill("x".repeat(257), "r")
    expect(screen.getByText(/at most 256 characters/)).toBeTruthy()
    fill("s", "y".repeat(2001))
    expect(screen.getByText(/A reason is at most 2000 characters/)).toBeTruthy()
  })

  it("refuses C1 control characters in the subject and the reason, as the server does", () => {
    renderDialog(scriptedClient({}).client)
    fill("sub\u0085ject", "r")
    expect(screen.getByText(/subject ID cannot contain control characters/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Count affected events" }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByRole("button", { name: "Erase" }).hasAttribute("disabled")).toBe(true)
    fill("s", "re\u009fason")
    expect(screen.getByText(/reason cannot contain control characters/i)).toBeTruthy()
    fill("s", "two\nlines")
    expect(screen.queryByText(/reason cannot contain control characters/i)).toBeNull()
  })

  it("keeps Erase disabled while a recount of the same subject is in flight", async () => {
    let calls = 0
    const c = scriptedClient({
      "erasures.preview": () => (++calls === 1 ? { subjectId: "s", eventsAffected: 1 } : new Promise(() => {})),
    })
    renderDialog(c.client)
    fill("s", "r")
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await screen.findByText(/1 event in your scope/)
    expect(screen.getByRole("button", { name: "Erase" }).hasAttribute("disabled")).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await waitFor(() => expect(calls).toBe(2))
    expect(screen.getByRole("button", { name: "Erase" }).hasAttribute("disabled")).toBe(true)
  })

  it("does not show a failed recount beside a finished erasure", async () => {
    let calls = 0
    const c = scriptedClient(
      { "erasures.preview": () => (++calls === 1 ? { subjectId: "s", eventsAffected: 1 } : new ContractError("INTERNAL", "count broke")) },
      {
        "erasures.request": () => {
          // The server names erasures.preview in the request's invalidates, so the mounted count refetches.
          queryStore.invalidate("chronicle", ["erasures.preview"])
          return { id: "erasure_9", subjectId: "s", eventsAffected: 1, keyDestroyed: true, legacyKeyRetained: false }
        },
      },
    )
    renderDialog(c.client)
    fill("s", "r")
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await screen.findByText(/1 event in your scope/)
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))
    await screen.findByText(/1 event erased. The key is destroyed./)
    await waitFor(() => expect(calls).toBe(2))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByText(/count broke/)).toBeNull()
  })

  it("cannot be dismissed while the request is in flight, so the result is not lost", async () => {
    const closes: boolean[] = []
    const inner = scriptedClient({ "erasures.preview": { subjectId: "s", eventsAffected: 1 } })
    const client = { ...inner.client, command: () => new Promise<never>(() => {}) } as ScopedClient
    render(
      <PluginProvider client={client}>
        <ErasureRequestDialog open onOpenChange={(o) => closes.push(o)} />
      </PluginProvider>,
    )
    fill("s", "r")
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await screen.findByText(/1 event in your scope/)
    // Before the request, Escape does dismiss: this is what the guard below must be holding back.
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" })
    await waitFor(() => expect(closes).toEqual([false]))
    closes.length = 0
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))
    await screen.findByRole("button", { name: "Working…" })
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" })
    await new Promise((r) => setTimeout(r, 20))
    expect(closes).toEqual([])
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })

  it("does not let a blank reason through", async () => {
    const c = scriptedClient({ "erasures.preview": { subjectId: "s", eventsAffected: 1 } })
    renderDialog(c.client)
    fill("s", "   ")
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await screen.findByText(/1 event in your scope/)
    expect(screen.getByRole("button", { name: "Erase" }).hasAttribute("disabled")).toBe(true)
  })

  it("never passes its own idempotency key, so every confirm is a new request", async () => {
    const opts: unknown[] = []
    const inner = scriptedClient(
      { "erasures.preview": { subjectId: "s", eventsAffected: 1 } },
      { "erasures.request": new ContractError("INTERNAL", "boom") },
    )
    const client = {
      ...inner.client,
      command: (intent: string, payload?: unknown, o?: unknown) => {
        opts.push(o)
        return inner.client.command(intent, payload)
      },
    } as ScopedClient
    renderDialog(client)
    fill("s", "r")
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await screen.findByText(/1 event in your scope/)
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))
    await waitFor(() => expect(opts).toHaveLength(1))
    await waitFor(() => expect((screen.getByRole("button", { name: "Erase" }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))
    await waitFor(() => expect(opts).toHaveLength(2))
    expect(opts).toEqual([undefined, undefined])
  })
})
