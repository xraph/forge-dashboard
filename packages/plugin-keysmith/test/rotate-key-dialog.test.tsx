import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import {
  ContractError,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { RotateKeyDialog } from "../src/components/rotate-key-dialog"
import type {
  KeyGraceClosed,
  KeyRotated,
  KeySummary,
  PolicyRef,
  PreviousKey,
} from "../src/types"
import { failingClient, recordingCommandClient } from "./harness"

// Obviously fake. A realistic-looking key never goes in a test.
const RAW_KEY = `sk_live_${"fedcba9876543210".repeat(2)}b7d2`

const ROTATED_AT = "2026-10-02T10:00:00Z"

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

const NEW_KEY: KeySummary = { ...KEY, hint: "b7d2", rotatedAt: ROTATED_AT }

const NO_POLICY_GRACE: PolicyRef = {
  id: "kpol_plain",
  name: "Plain",
  maxKeyLifetimeSeconds: null,
  graceSeconds: null,
}

function policy(graceSeconds: number | null): PolicyRef {
  return { ...NO_POLICY_GRACE, graceSeconds }
}

const THIS_WINDOW: PreviousKey = {
  rotationId: "krot_now",
  hint: "a3f8",
  reason: "manual",
  rotatedAt: ROTATED_AT,
  graceEnds: "2026-10-03T10:00:00Z",
}

const EARLIER_WINDOW: PreviousKey = {
  rotationId: "krot_before",
  hint: "7c1e",
  reason: "manual",
  rotatedAt: "2026-10-01T10:00:00Z",
  graceEnds: "2026-10-04T10:00:00Z",
}

function rotated(previousKeys: PreviousKey[]): KeyRotated {
  return { key: NEW_KEY, rawKey: RAW_KEY, previousKeys }
}

const CLOSED: KeyGraceClosed = { key: NEW_KEY, closed: 1 }

afterEach(() => {
  cleanup()
  queryStore.clear()
})

function Host({
  summary,
  keyPolicy,
}: {
  summary: KeySummary
  keyPolicy: PolicyRef | null
}) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open the dialog
      </button>
      <RotateKeyDialog
        open={open}
        onOpenChange={setOpen}
        summary={summary}
        policy={keyPolicy}
      />
    </>
  )
}

function mount(
  client: ScopedClient,
  options: { summary?: KeySummary; policy?: PolicyRef | null } = {}
) {
  return render(
    <PluginProvider client={client}>
      <Host
        summary={options.summary ?? KEY}
        keyPolicy={options.policy === undefined ? NO_POLICY_GRACE : options.policy}
      />
    </PluginProvider>
  )
}

function standard(answer: unknown = rotated([THIS_WINDOW])) {
  return recordingCommandClient(
    {},
    { "keys.rotate": answer, "keys.endGrace": CLOSED }
  )
}

async function dialog(): Promise<HTMLElement> {
  return screen.findByRole("dialog")
}

function rotateButton(): HTMLButtonElement {
  return within(screen.getByRole("dialog")).getByRole("button", {
    name: "Rotate key",
  }) as HTMLButtonElement
}

function graceInput(): HTMLInputElement {
  return screen.getByLabelText("Grace period") as HTMLInputElement
}

function unitSelect(): HTMLSelectElement {
  return screen.getByLabelText("Unit") as HTMLSelectElement
}

async function reveal(answer?: unknown) {
  const base = standard(answer)
  mount(base.client)
  await dialog()
  fireEvent.click(rotateButton())
  await screen.findByText("This is the only time Keysmith will show it.")
  return base
}

describe("RotateKeyDialog form", () => {
  it("opens titled Rotate key, with routine rotation and 24 hours marked default", async () => {
    mount(standard().client)
    const d = await dialog()
    expect(screen.getByRole("dialog", { name: "Rotate key" })).toBeTruthy()
    expect(
      (within(d).getByRole("radio", { name: "Routine rotation" }) as HTMLElement)
        .getAttribute("aria-checked")
    ).toBe("true")
    expect(graceInput().value).toBe("24")
    expect(unitSelect().value).toBe("hours")
    expect(within(d).getByText("(default)")).toBeTruthy()
  })

  it("presets the grace from the key's policy, in days when they divide", async () => {
    const view = mount(standard().client, { policy: policy(3 * 86400) })
    await dialog()
    expect(graceInput().value).toBe("3")
    expect(unitSelect().value).toBe("days")
    expect(screen.queryByText("(default)")).toBeNull()
    view.unmount()

    mount(standard().client, { policy: policy(36 * 3600) })
    await dialog()
    expect(graceInput().value).toBe("36")
    expect(unitSelect().value).toBe("hours")
  })

  it("lists the three reasons", async () => {
    mount(standard().client)
    const d = await dialog()
    for (const name of [
      "Routine rotation",
      "Suspected compromise",
      "Policy change",
    ]) {
      expect(within(d).getByRole("radio", { name })).toBeTruthy()
    }
  })
})

describe("RotateKeyDialog submit", () => {
  it("leaves graceSeconds out when the default 24 hours is untouched", async () => {
    const { client, sent } = standard()
    mount(client)
    await dialog()
    fireEvent.click(rotateButton())
    await screen.findByText("This is the only time Keysmith will show it.")
    expect(sent).toEqual([
      { intent: "keys.rotate", payload: { id: "akey_billing", reason: "manual" } },
    ])
    expect("graceSeconds" in (sent[0].payload as object)).toBe(false)
  })

  it("sends the policy's grace as chosen when the policy sets one", async () => {
    const { client, sent } = standard()
    mount(client, { policy: policy(36 * 3600) })
    await dialog()
    fireEvent.click(rotateButton())
    await screen.findByText("This is the only time Keysmith will show it.")
    expect(sent[0].payload).toEqual({
      id: "akey_billing",
      reason: "manual",
      graceSeconds: 36 * 3600,
    })
  })

  it("sends an edited grace, in the unit chosen", async () => {
    const { client, sent } = standard()
    mount(client)
    await dialog()
    fireEvent.click(screen.getByRole("radio", { name: "Policy change" }))
    fireEvent.change(graceInput(), { target: { value: "2" } })
    fireEvent.change(unitSelect(), { target: { value: "days" } })
    fireEvent.click(rotateButton())
    await screen.findByText("This is the only time Keysmith will show it.")
    expect(sent[0].payload).toEqual({
      id: "akey_billing",
      reason: "policy",
      graceSeconds: 2 * 86400,
    })
  })

  it("sends the default value explicitly once the operator has edited it", async () => {
    const { client, sent } = standard()
    mount(client)
    await dialog()
    fireEvent.change(graceInput(), { target: { value: "12" } })
    fireEvent.change(graceInput(), { target: { value: "24" } })
    fireEvent.click(rotateButton())
    await screen.findByText("This is the only time Keysmith will show it.")
    expect(sent[0].payload).toEqual({
      id: "akey_billing",
      reason: "manual",
      graceSeconds: 86400,
    })
  })

  it("presets 0 hours for suspected compromise, warns, and sends 0", async () => {
    const { client, sent } = standard(rotated([]))
    mount(client, { policy: policy(36 * 3600) })
    await dialog()
    expect(
      screen.queryByText("The current key stops working the moment you rotate.")
    ).toBeNull()
    fireEvent.click(screen.getByRole("radio", { name: "Suspected compromise" }))
    expect(graceInput().value).toBe("0")
    expect(unitSelect().value).toBe("hours")
    expect(
      screen.getByText("The current key stops working the moment you rotate.")
    ).toBeTruthy()
    fireEvent.click(rotateButton())
    await screen.findByText("This is the only time Keysmith will show it.")
    expect(sent[0].payload).toEqual({
      id: "akey_billing",
      reason: "compromise",
      graceSeconds: 0,
    })
  })

  it("lets the operator change the grace after picking compromise", async () => {
    const { client, sent } = standard()
    mount(client)
    await dialog()
    fireEvent.click(screen.getByRole("radio", { name: "Suspected compromise" }))
    fireEvent.change(graceInput(), { target: { value: "1" } })
    expect(
      screen.queryByText("The current key stops working the moment you rotate.")
    ).toBeNull()
    fireEvent.click(rotateButton())
    await screen.findByText("This is the only time Keysmith will show it.")
    expect(sent[0].payload).toEqual({
      id: "akey_billing",
      reason: "compromise",
      graceSeconds: 3600,
    })
  })

  it("goes back to the preset when compromise is dropped without an edit", async () => {
    mount(standard().client, { policy: policy(36 * 3600) })
    await dialog()
    fireEvent.click(screen.getByRole("radio", { name: "Suspected compromise" }))
    fireEvent.click(screen.getByRole("radio", { name: "Routine rotation" }))
    expect(graceInput().value).toBe("36")
    expect(
      screen.queryByText("The current key stops working the moment you rotate.")
    ).toBeNull()
  })

  it("refuses a grace outside 0 hours to 90 days without sending", async () => {
    const { client, sent } = standard()
    mount(client)
    await dialog()
    for (const [value, unit] of [
      ["91", "days"],
      ["2161", "hours"],
      ["-1", "hours"],
      ["1.5", "hours"],
      ["", "hours"],
    ]) {
      fireEvent.change(unitSelect(), { target: { value: unit } })
      fireEvent.change(graceInput(), { target: { value } })
      fireEvent.click(rotateButton())
      const alert = await screen.findByRole("alert")
      expect(alert.textContent).toBe("Grace must be between 0 hours and 90 days.")
    }
    expect(sent).toHaveLength(0)

    // The limit itself is fine.
    fireEvent.change(unitSelect(), { target: { value: "days" } })
    fireEvent.change(graceInput(), { target: { value: "90" } })
    fireEvent.click(rotateButton())
    await screen.findByText("This is the only time Keysmith will show it.")
    expect(sent[0].payload).toEqual({
      id: "akey_billing",
      reason: "manual",
      graceSeconds: 7776000,
    })
  })

  it("shows a server error inside the dialog and keeps the form", async () => {
    mount(
      failingClient(
        new ContractError("CONFLICT", "a revoked or expired key cannot be rotated")
      )
    )
    await dialog()
    fireEvent.click(rotateButton())
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe("a revoked or expired key cannot be rotated")
    expect(screen.getByRole("dialog").contains(alert)).toBe(true)
    expect(rotateButton().disabled).toBe(false)
    expect(graceInput().value).toBe("24")
  })

  it("sends one command however many times Rotate is pressed while pending", async () => {
    const base = standard()
    let release: (value: unknown) => void = () => {}
    const client = {
      extension: base.client.extension,
      query: base.client.query,
      command: (intent: string, payload?: unknown) => {
        base.sent.push({ intent, payload })
        return new Promise<unknown>((resolve) => {
          release = resolve
        })
      },
    } as ScopedClient
    mount(client)
    await dialog()
    fireEvent.click(rotateButton())

    await waitFor(() => expect(rotateButton().disabled).toBe(true))
    fireEvent.click(rotateButton())
    fireEvent.click(rotateButton())
    expect(base.sent).toHaveLength(1)

    // The answer would have nowhere to show if the dialog closed now.
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull()

    release(rotated([THIS_WINDOW]))
    await screen.findByText("This is the only time Keysmith will show it.")
  })
})

describe("RotateKeyDialog reveal", () => {
  it("shows the key once, under a single accessible name", async () => {
    await reveal()
    const d = screen.getByRole("dialog", { name: "Save your new key" })
    expect(d.textContent).toContain(RAW_KEY)
    expect(within(d).queryAllByRole("heading")).toHaveLength(1)
    expect(screen.queryByLabelText("Grace period")).toBeNull()
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull()
  })

  it("does not close on Escape or an outside click while the key is up", async () => {
    await reveal()
    fireEvent.keyDown(document.body, { key: "Escape" })
    fireEvent.pointerDown(document.body)
    fireEvent.mouseDown(document.body)
    fireEvent.click(document.body)
    expect(screen.getByRole("dialog").textContent).toContain(RAW_KEY)
  })

  it("lists the open window with its cutoff and an End now", async () => {
    await reveal()
    const d = screen.getByRole("dialog")
    const item = within(d).getByText("sk_live_…a3f8").closest("li")
    expect(item).toBeTruthy()
    expect(item?.textContent).toContain("keeps working until")
    expect(item?.textContent).toMatch(/2026/)
    expect(within(item as HTMLElement).getByRole("button", { name: "End now" })).toBeTruthy()
    expect(within(d).queryByText(/An earlier previous key/)).toBeNull()
    expect(
      within(d).queryByText("Your previous key stopped working when you rotated.")
    ).toBeNull()
  })

  it("says the previous key stopped when no window is open", async () => {
    await reveal(rotated([]))
    const d = screen.getByRole("dialog")
    expect(
      within(d).getByText("Your previous key stopped working when you rotated.")
    ).toBeTruthy()
    expect(within(d).queryByRole("button", { name: "End now" })).toBeNull()
    expect(within(d).queryByText(/An earlier previous key/)).toBeNull()
  })

  it("shows an earlier window a zero-grace rotation left open, and says so", async () => {
    mount(standard(rotated([EARLIER_WINDOW])).client)
    await dialog()
    fireEvent.click(screen.getByRole("radio", { name: "Suspected compromise" }))
    fireEvent.click(rotateButton())
    await screen.findByText("This is the only time Keysmith will show it.")
    const d = screen.getByRole("dialog")
    expect(within(d).getByText("sk_live_…7c1e")).toBeTruthy()
    expect(
      within(d).getByText(
        "An earlier previous key is still accepted. End it now if it may also be compromised."
      )
    ).toBeTruthy()
    // The key just rotated did not open a window of its own.
    expect(within(d).queryByText("sk_live_…a3f8")).toBeNull()
    expect(
      within(d).queryByText("Your previous key stopped working when you rotated.")
    ).toBeNull()
  })

  it("says to end an earlier window for a compromise even with some grace", async () => {
    mount(standard(rotated([THIS_WINDOW, EARLIER_WINDOW])).client)
    await dialog()
    fireEvent.click(screen.getByRole("radio", { name: "Suspected compromise" }))
    fireEvent.change(graceInput(), { target: { value: "1" } })
    fireEvent.click(rotateButton())
    await screen.findByText("This is the only time Keysmith will show it.")
    expect(
      within(screen.getByRole("dialog")).getByText(
        "An earlier previous key is still accepted. End it now if it may also be compromised."
      )
    ).toBeTruthy()
  })

  it("lists this rotation's window and the earlier one together, neutrally on a routine rotation", async () => {
    await reveal(rotated([THIS_WINDOW, EARLIER_WINDOW]))
    const d = screen.getByRole("dialog")
    expect(within(d).getByText("sk_live_…a3f8")).toBeTruthy()
    expect(within(d).getByText("sk_live_…7c1e")).toBeTruthy()
    expect(
      within(d).getByText("An earlier previous key is still accepted.")
    ).toBeTruthy()
    expect(within(d).queryByText(/may also be compromised/)).toBeNull()
  })

  it("finds this rotation's window by the hint it had when sent, not the page's new one", async () => {
    const { client } = standard(rotated([THIS_WINDOW]))
    const view = mount(client)
    await dialog()
    fireEvent.click(rotateButton())
    await screen.findByText("This is the only time Keysmith will show it.")

    // The page refetches and hands the dialog the rotated key.
    view.rerender(
      <PluginProvider client={client}>
        <Host summary={NEW_KEY} keyPolicy={NO_POLICY_GRACE} />
      </PluginProvider>
    )
    const d = screen.getByRole("dialog")
    expect(d.textContent).toContain(RAW_KEY)
    expect(within(d).getByText("sk_live_…a3f8")).toBeTruthy()
    expect(within(d).queryByText(/An earlier previous key/)).toBeNull()
  })

  it("counts an earlier window that happens to share the old hint", async () => {
    const sameHint: PreviousKey = { ...EARLIER_WINDOW, hint: "a3f8" }
    await reveal(rotated([sameHint, THIS_WINDOW]))
    const d = screen.getByRole("dialog")
    expect(within(d).getAllByText("sk_live_…a3f8")).toHaveLength(2)
    expect(within(d).getByText("An earlier previous key is still accepted.")).toBeTruthy()
  })

  it("forgets the key after Done: not in the page, not in the store", async () => {
    await reveal()
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    expect(document.body.textContent).not.toContain(RAW_KEY)
    // Reaches into a private field on purpose: the query store has no public
    // listing, and "the raw key is in no cache" is exactly the property that
    // matters here.
    const records = (queryStore as unknown as { records: Map<string, unknown> })
      .records
    expect(JSON.stringify([...records.values()])).not.toContain(RAW_KEY)

    fireEvent.click(screen.getByRole("button", { name: "Open the dialog" }))
    await dialog()
    expect(document.body.textContent).not.toContain(RAW_KEY)
    expect(graceInput().value).toBe("24")
  })
})

describe("RotateKeyDialog End now", () => {
  it("asks first, naming the key, then sends keys.endGrace once on a double click", async () => {
    const base = standard()
    let release: (value: unknown) => void = () => {}
    const client = {
      extension: base.client.extension,
      query: base.client.query,
      command: (intent: string, payload?: unknown) => {
        if (intent === "keys.rotate") return base.client.command(intent, payload)
        base.sent.push({ intent, payload })
        return new Promise<unknown>((resolve) => {
          release = resolve
        })
      },
    } as ScopedClient
    mount(client)
    await dialog()
    fireEvent.click(rotateButton())
    await screen.findByText("This is the only time Keysmith will show it.")

    fireEvent.click(screen.getByRole("button", { name: "End now" }))
    const confirm = await screen.findByRole("alertdialog", {
      name: "Stop accepting sk_live_…a3f8?",
    })
    expect(
      within(confirm).getByText(
        "Requests using it fail from now on. This cannot be undone."
      )
    ).toBeTruthy()
    expect(base.sent.filter((s) => s.intent === "keys.endGrace")).toHaveLength(0)

    const go = within(confirm).getByRole("button", { name: "End now" })
    fireEvent.click(go)
    fireEvent.click(go)
    fireEvent.click(go)
    await waitFor(() =>
      expect(
        (within(confirm).getByRole("button", { name: "Working…" }) as HTMLButtonElement)
          .disabled
      ).toBe(true)
    )
    expect(base.sent.filter((s) => s.intent === "keys.endGrace")).toEqual([
      { intent: "keys.endGrace", payload: { id: "akey_billing" } },
    ])

    release(CLOSED)
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    // The window is gone from the reveal, and the key is still on show.
    const d = screen.getByRole("dialog")
    expect(d.textContent).toContain(RAW_KEY)
    expect(within(d).queryByText("sk_live_…a3f8")).toBeNull()
    expect(within(d).queryByRole("button", { name: "End now" })).toBeNull()
    expect(within(d).getByText("Every previous key has been stopped.")).toBeTruthy()
  })

  it("asks about every previous key when there are several", async () => {
    await reveal(rotated([THIS_WINDOW, EARLIER_WINDOW]))
    fireEvent.click(screen.getAllByRole("button", { name: "End now" })[0])
    const confirm = await screen.findByRole("alertdialog", {
      name: "Stop accepting every previous key?",
    })
    expect(
      within(confirm).getByText(
        "Requests using any of them fail from now on. This cannot be undone."
      )
    ).toBeTruthy()
  })

  it("shows a failure inside the confirmation and keeps the window", async () => {
    const client = {
      extension: "keysmith",
      query: async () => {
        throw new Error("no queries")
      },
      command: async (intent: string) => {
        if (intent === "keys.rotate") return rotated([THIS_WINDOW])
        throw new ContractError("INTERNAL", "could not end the window")
      },
    } as unknown as ScopedClient
    mount(client)
    await dialog()
    fireEvent.click(rotateButton())
    await screen.findByText("This is the only time Keysmith will show it.")
    fireEvent.click(screen.getByRole("button", { name: "End now" }))
    const confirm = await screen.findByRole("alertdialog")
    fireEvent.click(within(confirm).getByRole("button", { name: "End now" }))
    const alert = await within(confirm).findByRole("alert")
    expect(alert.textContent).toBe("could not end the window")
    expect(screen.getByRole("dialog").textContent).toContain("sk_live_…a3f8")

    // Cancelling and opening it again does not show the old failure.
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "End now" }))
    const again = await screen.findByRole("alertdialog")
    expect(within(again).queryByRole("alert")).toBeNull()
  })
})
