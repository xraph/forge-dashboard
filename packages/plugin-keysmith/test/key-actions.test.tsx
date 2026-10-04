import { useState } from "react"
import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import {
  KeyStateActions,
  RevokeKeyDialog,
  SuspendKeyDialog,
} from "../src/components/key-actions"
import type { KeySummary } from "../src/types"
import { failingClient, pendingClient, recordingCommandClient } from "./harness"

const KEY: KeySummary = {
  id: "akey_billing",
  name: "Billing service",
  prefix: "sk",
  hint: "a3f8",
  environment: "live",
  state: "active",
  effectiveState: "active",
  expiryPending: false,
  expiresSoon: false,
  scopes: [],
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-09-25T10:00:00Z",
}

const MASKED = "sk_live_…a3f8"

type Dialog = typeof RevokeKeyDialog

/**
 * A dialog the way the page holds it: open state outside, and a button on the
 * page that opens it again after it closes.
 */
function Host({ Dialog: D }: { Dialog: Dialog }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open again
      </button>
      <D open={open} onOpenChange={setOpen} keyId={KEY.id} masked={MASKED} />
    </>
  )
}

function renderDialog(D: Dialog, client: ScopedClient) {
  return render(
    <PluginProvider client={client}>
      <Host Dialog={D} />
    </PluginProvider>,
  )
}

function reasonField(dialog: HTMLElement): HTMLTextAreaElement {
  return within(dialog).getByLabelText("Reason") as HTMLTextAreaElement
}

function confirmButton(dialog: HTMLElement, name: string): HTMLButtonElement {
  return within(dialog).getByRole("button", { name }) as HTMLButtonElement
}

describe("RevokeKeyDialog", () => {
  it("names the key and says what revoking costs", async () => {
    renderDialog(RevokeKeyDialog, recordingCommandClient({}).client)
    const d = await screen.findByRole("alertdialog", { name: `Revoke ${MASKED}?` })
    expect(
      within(d).getByText(
        "Requests using this key fail from now on, and any open grace window ends with it. A revoked key cannot be brought back.",
      ),
    ).toBeTruthy()
  })

  it("waits for a reason before it can be confirmed", async () => {
    renderDialog(RevokeKeyDialog, recordingCommandClient({}).client)
    const d = await screen.findByRole("alertdialog")
    expect(confirmButton(d, "Revoke").disabled).toBe(true)
    fireEvent.change(reasonField(d), { target: { value: "   " } })
    expect(confirmButton(d, "Revoke").disabled).toBe(true)
    fireEvent.change(reasonField(d), { target: { value: "Leaked in a ticket" } })
    expect(confirmButton(d, "Revoke").disabled).toBe(false)
  })

  it("puts the reason field in the body, not in the description", async () => {
    renderDialog(RevokeKeyDialog, recordingCommandClient({}).client)
    const d = await screen.findByRole("alertdialog")
    expect(reasonField(d).closest("p")).toBeNull()
  })

  it("sends keys.revoke once with the trimmed reason on a double click, then closes", async () => {
    const { client, sent } = recordingCommandClient(
      {},
      { "keys.revoke": { key: { ...KEY, state: "revoked", effectiveState: "revoked" } } },
    )
    renderDialog(RevokeKeyDialog, client)
    const d = await screen.findByRole("alertdialog")
    fireEvent.change(reasonField(d), { target: { value: "  Leaked in a ticket  " } })
    const go = confirmButton(d, "Revoke")
    fireEvent.click(go)
    fireEvent.click(go)
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(sent).toEqual([
      { intent: "keys.revoke", payload: { id: KEY.id, reason: "Leaked in a ticket" } },
    ])
  })

  it.each([
    ["CONFLICT", "this key is already revoked"],
    ["BAD_REQUEST", "reason must be at most 500 characters"],
  ])("shows a %s refusal inside the dialog and stays open", async (code, message) => {
    renderDialog(RevokeKeyDialog, failingClient(new ContractError(code, message)))
    const d = await screen.findByRole("alertdialog")
    fireEvent.change(reasonField(d), { target: { value: "Leaked" } })
    fireEvent.click(confirmButton(d, "Revoke"))
    const alert = await within(d).findByRole("alert")
    expect(alert.textContent).toBe(message)
    // Not inside the description: that is a <p>, and it names the dialog's
    // consequence, not this attempt's failure.
    const description = within(d).getByText(/^Requests using this key fail/)
    expect(description.contains(alert)).toBe(false)
    expect(screen.getByRole("alertdialog")).toBe(d)
    // The reason is kept, so a retry is one click.
    expect(reasonField(d).value).toBe("Leaked")
  })

  it("forgets the last error and reason when it opens again", async () => {
    renderDialog(
      RevokeKeyDialog,
      failingClient(new ContractError("CONFLICT", "this key is already revoked")),
    )
    const d = await screen.findByRole("alertdialog")
    fireEvent.change(reasonField(d), { target: { value: "Leaked" } })
    fireEvent.click(confirmButton(d, "Revoke"))
    await within(d).findByRole("alert")

    fireEvent.click(within(d).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Open again" }))
    const again = await screen.findByRole("alertdialog")
    expect(within(again).queryByRole("alert")).toBeNull()
    expect(reasonField(again).value).toBe("")
  })

  it("cannot be closed while the command is out", async () => {
    renderDialog(RevokeKeyDialog, pendingClient())
    const d = await screen.findByRole("alertdialog")
    fireEvent.change(reasonField(d), { target: { value: "Leaked" } })
    fireEvent.click(confirmButton(d, "Revoke"))
    await waitFor(() =>
      expect(
        (within(d).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled,
      ).toBe(true),
    )
    fireEvent.keyDown(d, { key: "Escape" })
    expect(screen.getByRole("alertdialog")).toBe(d)
  })
})

describe("SuspendKeyDialog", () => {
  it("names the key and says what suspending does", async () => {
    renderDialog(SuspendKeyDialog, recordingCommandClient({}).client)
    const d = await screen.findByRole("alertdialog", { name: `Suspend ${MASKED}?` })
    expect(
      within(d).getByText(
        "Requests using it fail until you reactivate it. Open grace windows keep running.",
      ),
    ).toBeTruthy()
    expect(within(d).queryByLabelText("Reason")).toBeNull()
  })

  it("sends keys.suspend once with the id on a double click, then closes", async () => {
    const { client, sent } = recordingCommandClient(
      {},
      { "keys.suspend": { key: { ...KEY, state: "suspended", effectiveState: "suspended" } } },
    )
    renderDialog(SuspendKeyDialog, client)
    const d = await screen.findByRole("alertdialog")
    const go = confirmButton(d, "Suspend")
    fireEvent.click(go)
    fireEvent.click(go)
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(sent).toEqual([{ intent: "keys.suspend", payload: { id: KEY.id } }])
  })

  it("shows the server's refusal inside the dialog", async () => {
    renderDialog(
      SuspendKeyDialog,
      failingClient(new ContractError("CONFLICT", "only an active key can be suspended")),
    )
    const d = await screen.findByRole("alertdialog")
    fireEvent.click(confirmButton(d, "Suspend"))
    const alert = await within(d).findByRole("alert")
    expect(alert.textContent).toBe("only an active key can be suspended")
  })

  it("forgets the last error when it opens again", async () => {
    renderDialog(
      SuspendKeyDialog,
      failingClient(new ContractError("CONFLICT", "only an active key can be suspended")),
    )
    const d = await screen.findByRole("alertdialog")
    fireEvent.click(confirmButton(d, "Suspend"))
    await within(d).findByRole("alert")
    fireEvent.click(within(d).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Open again" }))
    const again = await screen.findByRole("alertdialog")
    expect(within(again).queryByRole("alert")).toBeNull()
  })
})

describe("KeyStateActions", () => {
  function renderActions(summary: KeySummary) {
    render(
      <KeyStateActions
        summary={summary}
        onSuspend={() => {}}
        onRevoke={() => {}}
        onReactivate={() => {}}
        reactivating={false}
      />,
    )
  }

  function names(): string[] {
    return screen.queryAllByRole("button").map((b) => b.textContent ?? "")
  }

  it("offers Suspend and Revoke on an active key", () => {
    renderActions(KEY)
    expect(names()).toEqual(["Suspend", "Revoke"])
  })

  it("offers Reactivate and Revoke on a suspended key", () => {
    renderActions({ ...KEY, state: "suspended", effectiveState: "suspended" })
    expect(names()).toEqual(["Reactivate", "Revoke"])
  })

  it("offers nothing on a revoked key", () => {
    renderActions({ ...KEY, state: "revoked", effectiveState: "revoked" })
    expect(names()).toEqual([])
  })

  it("offers only Revoke on an expired key that is not yet marked", () => {
    renderActions({ ...KEY, effectiveState: "expired", expiryPending: true })
    expect(names()).toEqual(["Revoke"])
  })

  it("offers only Revoke on a marked expired key", () => {
    renderActions({ ...KEY, state: "expired", effectiveState: "expired" })
    expect(names()).toEqual(["Revoke"])
  })

  it("disables Reactivate while it is out", () => {
    render(
      <KeyStateActions
        summary={{ ...KEY, state: "suspended", effectiveState: "suspended" }}
        onSuspend={() => {}}
        onRevoke={() => {}}
        onReactivate={() => {}}
        reactivating
      />,
    )
    expect(
      (screen.getByRole("button", { name: "Reactivate" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
