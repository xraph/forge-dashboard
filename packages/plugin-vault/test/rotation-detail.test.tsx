import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  ContractError,
  NavigationProvider,
  PluginProvider,
} from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { RotationDetailPage } from "../src/pages/rotation-detail"
import { secretPath } from "../src/keys"
import { stubClient } from "./harness"

/**
 * jsdom 25 has no PointerEvent, and Base UI's checkbox dispatches one when it
 * is clicked. A MouseEvent subclass is what a click is, so the checkbox works.
 */
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim })
}

const KEY = "db/primary.password"

function policy(over: Record<string, unknown> = {}) {
  return {
    id: "pol_01",
    secretKey: KEY,
    intervalSeconds: 21600,
    enabled: true,
    rotatable: true,
    lastRotatedAt: "2026-09-22T04:00:00Z",
    nextRotationAt: "2026-09-29T04:00:00Z",
    createdAt: "2026-09-20T10:00:00Z",
    updatedAt: "2026-09-22T04:00:00Z",
    ...over,
  }
}

function detail(over: Record<string, unknown> = {}) {
  return { policy: policy(), rotatable: true, records: [] as unknown[], ...over }
}

const NO_POLICY = detail({ policy: null })

const RECORDS = [
  {
    id: "rec_2",
    oldVersion: 3,
    newVersion: 4,
    rotatedBy: "usr_1",
    rotatedAt: "2026-09-22T04:00:00Z",
  },
  { id: "rec_1", oldVersion: 2, newVersion: 3, rotatedAt: "2026-09-21T04:00:00Z" },
]

interface Harness {
  client: ScopedClient
  queries: { intent: string; params?: unknown }[]
  commands: { intent: string; payload?: unknown }[]
}

/** One client that records both the reads and the writes a page sends. */
function harness(
  answer: unknown = detail(),
  commands: Record<string, unknown> = {}
): Harness {
  const queries: Harness["queries"] = []
  const sent: Harness["commands"] = []
  const inner = stubClient({ "rotation.detail": answer }, commands)
  return {
    queries,
    commands: sent,
    client: {
      extension: inner.extension,
      query: (intent: string, params?: Record<string, unknown>) => {
        queries.push({ intent, params })
        return inner.query(intent, params)
      },
      command: (intent: string, payload?: unknown) => {
        sent.push({ intent, payload })
        return inner.command(intent, payload)
      },
    } as ScopedClient,
  }
}

/** A client whose commands throw, for the failure path. */
function failingCommands(error: ContractError, answer: unknown = detail()): Harness {
  const h = harness(answer)
  return {
    ...h,
    client: {
      ...h.client,
      command: async (intent: string, payload?: unknown) => {
        h.commands.push({ intent, payload })
        throw error
      },
    } as ScopedClient,
  }
}

/** A client whose commands never settle. */
function neverSettles(answer: unknown = detail()): Harness {
  const h = harness(answer)
  return {
    ...h,
    client: {
      ...h.client,
      command: (intent: string, payload?: unknown) => {
        h.commands.push({ intent, payload })
        return new Promise<never>(() => {})
      },
    } as ScopedClient,
  }
}

function renderDetail(client: ScopedClient, params: Record<string, string> = { key: KEY }) {
  render(
    <PluginProvider client={client}>
      <NavigationProvider
        value={{
          Link: ({ to, children, className }) => (
            <a href={to} className={className}>
              {children}
            </a>
          ),
          navigate: vi.fn(),
        }}
      >
        <RotationDetailPage params={params} />
      </NavigationProvider>
    </PluginProvider>
  )
}

const interval = () => screen.getByLabelText("Rotate every") as HTMLInputElement
const unit = () => screen.getByLabelText("Interval unit") as HTMLSelectElement
const enabledBox = () => screen.getByRole("checkbox") as HTMLElement
const save = () =>
  screen.getByRole("button", { name: /^(Create|Save) policy$/ }) as HTMLButtonElement

async function ready() {
  await screen.findByLabelText("Rotate every")
}

function setInterval(amount: string, u: "hours" | "days") {
  fireEvent.change(interval(), { target: { value: amount } })
  fireEvent.change(unit(), { target: { value: u } })
}

describe("RotationDetailPage reads", () => {
  it("asks rotation.detail for the key in the address", async () => {
    const h = harness()
    renderDetail(h.client)
    await ready()
    expect(h.queries.filter((q) => q.intent === "rotation.detail")[0]?.params).toEqual({
      key: KEY,
    })
  })

  it("says so and sends no query when the address has no key", () => {
    const h = harness()
    renderDetail(h.client, {})
    expect(screen.getByRole("status").textContent).toMatch(/No secret key/)
    expect(h.queries).toEqual([])
  })

  it("renders the error card, not an empty form, for a secret that does not exist", async () => {
    const failing = {
      extension: "vault",
      query: async () => {
        throw new ContractError("NOT_FOUND", "secret not found")
      },
      command: async () => undefined,
    } as unknown as ScopedClient
    renderDetail(failing, { key: "gone" })
    expect(await screen.findByText(/Rotation unavailable/)).toBeTruthy()
    expect(screen.getByText(/NOT_FOUND: secret not found/)).toBeTruthy()
    expect(screen.queryByLabelText("Rotate every")).toBeNull()
    expect(screen.queryByRole("button", { name: /Create policy/ })).toBeNull()
  })

  it("links back to the secret through secretPath", async () => {
    renderDetail(harness().client)
    const link = await screen.findByRole("link", { name: "View secret" })
    expect(link.getAttribute("href")).toBe(secretPath(KEY))
  })
})

describe("RotationDetailPage create (no policy)", () => {
  it("shows a create form and no delete button", async () => {
    renderDetail(harness(NO_POLICY).client)
    await ready()
    expect(save().textContent).toBe("Create policy")
    expect(screen.queryByRole("button", { name: "Delete policy" })).toBeNull()
    // Nothing is claimed about a policy that does not exist.
    expect(screen.queryByText("Next rotation")).toBeNull()
  })

  it("sends key, seconds computed from hours, and enabled", async () => {
    const h = harness(NO_POLICY, {
      "rotation.savePolicy": { policy: policy({ intervalSeconds: 43200 }) },
    })
    renderDetail(h.client)
    await ready()
    setInterval("12", "hours")
    fireEvent.click(save())
    await screen.findByText("Policy saved.")
    expect(h.commands).toEqual([
      {
        intent: "rotation.savePolicy",
        payload: { key: KEY, intervalSeconds: 43200, enabled: true },
      },
    ])
  })

  it("computes seconds from days and sends enabled false when unchecked", async () => {
    const h = harness(NO_POLICY, { "rotation.savePolicy": { policy: policy() } })
    renderDetail(h.client)
    await ready()
    setInterval("2", "days")
    fireEvent.click(enabledBox())
    fireEvent.click(save())
    await screen.findByText("Policy saved.")
    expect(h.commands[0]?.payload).toEqual({
      key: KEY,
      intervalSeconds: 172800,
      enabled: false,
    })
  })

  it("rounds a fractional interval to whole seconds", async () => {
    const h = harness(NO_POLICY, { "rotation.savePolicy": { policy: policy() } })
    renderDetail(h.client)
    await ready()
    setInterval("1.5", "hours")
    fireEvent.click(save())
    await screen.findByText("Policy saved.")
    expect((h.commands[0]?.payload as { intervalSeconds: number }).intervalSeconds).toBe(5400)
  })

  it("refuses an interval below 60 seconds with a message and sends nothing", async () => {
    const h = harness(NO_POLICY, { "rotation.savePolicy": { policy: policy() } })
    renderDetail(h.client)
    await ready()
    setInterval("0.01", "hours") // 36 seconds
    expect((await screen.findByRole("alert")).textContent).toMatch(/at least 60 seconds/)
    expect(save().disabled).toBe(true)
    fireEvent.click(save())
    // Enter in the field submits the form even with the button disabled.
    fireEvent.submit(interval().closest("form")!)
    await new Promise((r) => setTimeout(r, 20))
    expect(h.commands).toEqual([])
  })

  it("accepts an interval just over the minimum", async () => {
    const h = harness(NO_POLICY, { "rotation.savePolicy": { policy: policy() } })
    renderDetail(h.client)
    await ready()
    setInterval("0.02", "hours") // 72 seconds
    expect(screen.queryByRole("alert")).toBeNull()
    fireEvent.click(save())
    await screen.findByText("Policy saved.")
    expect((h.commands[0]?.payload as { intervalSeconds: number }).intervalSeconds).toBe(72)
  })

  it("cannot submit an empty interval, and says nothing about it", async () => {
    const h = harness(NO_POLICY)
    renderDetail(h.client)
    await ready()
    fireEvent.change(interval(), { target: { value: "" } })
    expect(save().disabled).toBe(true)
    fireEvent.submit(interval().closest("form")!)
    await new Promise((r) => setTimeout(r, 20))
    expect(h.commands).toEqual([])
  })

  it("renders a failed save above the form and keeps what was typed", async () => {
    const h = failingCommands(
      new ContractError("VALIDATION", "interval too short for this vault"),
      NO_POLICY
    )
    renderDetail(h.client)
    await ready()
    setInterval("3", "days")
    fireEvent.click(save())
    const alert = await screen.findByText(/interval too short for this vault/)
    expect(screen.getByText("Could not save the policy")).toBeTruthy()
    const form = interval().closest("form")!
    expect(
      alert.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(interval().value).toBe("3")
    expect(unit().value).toBe("days")
    expect(screen.queryByText("Policy saved.")).toBeNull()
  })
})

describe("RotationDetailPage edit (policy present)", () => {
  it("prefills whole days as days", async () => {
    renderDetail(harness(detail({ policy: policy({ intervalSeconds: 172800 }) })).client)
    await ready()
    expect(interval().value).toBe("2")
    expect(unit().value).toBe("days")
    expect(save().textContent).toBe("Save policy")
  })

  it("prefills hours as hours and sends the same seconds back", async () => {
    const h = harness(detail(), { "rotation.savePolicy": { policy: policy() } })
    renderDetail(h.client)
    await ready()
    expect(interval().value).toBe("6")
    expect(unit().value).toBe("hours")
    fireEvent.click(save())
    await screen.findByText("Policy saved.")
    expect(h.commands[0]?.payload).toEqual({ key: KEY, intervalSeconds: 21600, enabled: true })
  })

  it("keeps an interval that is not whole hours exact when saved untouched", async () => {
    const h = harness(detail({ policy: policy({ intervalSeconds: 100 }) }), {
      "rotation.savePolicy": { policy: policy() },
    })
    renderDetail(h.client)
    await ready()
    fireEvent.click(save())
    await screen.findByText("Policy saved.")
    expect((h.commands[0]?.payload as { intervalSeconds: number }).intervalSeconds).toBe(100)
  })

  it("prefills the enabled checkbox from the policy", async () => {
    renderDetail(harness(detail({ policy: policy({ enabled: false }) })).client)
    await ready()
    expect(enabledBox().getAttribute("aria-checked")).toBe("false")
  })

  it("shows next rotation for an enabled policy", async () => {
    renderDetail(harness().client)
    await ready()
    expect(screen.queryByLabelText(/no next rotation/i)).toBeNull()
    expect(screen.getByText(new Date("2026-09-29T04:00:00Z").toLocaleString())).toBeTruthy()
  })

  it("shows no next rotation for a disabled policy, even when the payload carries one", async () => {
    renderDetail(
      harness(
        detail({ policy: policy({ enabled: false, nextRotationAt: "2026-10-05T04:00:00Z" }) })
      ).client
    )
    await ready()
    expect(screen.getByLabelText(/no next rotation/i)).toBeTruthy()
    expect(screen.queryByText(new Date("2026-10-05T04:00:00Z").toLocaleString())).toBeNull()
  })
})

describe("RotationDetailPage next rotation needs a rotator", () => {
  it("shows no next rotation for an enabled policy with no rotator, even when the payload carries one", async () => {
    renderDetail(
      harness(
        detail({
          rotatable: false,
          policy: policy({ rotatable: false, nextRotationAt: "2026-10-05T04:00:00Z" }),
        })
      ).client
    )
    await ready()
    expect(screen.getByLabelText(/no next rotation/i)).toBeTruthy()
    expect(screen.queryByText(new Date("2026-10-05T04:00:00Z").toLocaleString())).toBeNull()
  })
})

describe("RotationDetailPage save preview", () => {
  const preview = () => screen.queryByText(/^This secret will rotate every/)

  it("states what saving does for a rotatable secret with the box checked", async () => {
    renderDetail(harness(NO_POLICY).client)
    await ready()
    const line = preview()
    expect(line).toBeTruthy()
    expect(line!.textContent).toMatch(/^This secret will rotate every 1 day, first at about /)
    expect(line!.textContent).toMatch(/Applications must pick up each new value\.$/)
  })

  it("computes the first time as now plus the interval, formatted like the other times", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      vi.setSystemTime(new Date("2026-10-01T00:00:00Z"))
      renderDetail(harness(NO_POLICY).client)
      await ready()
      setInterval("6", "hours")
      const expected = new Date("2026-10-01T06:00:00Z").toLocaleString()
      expect(preview()!.textContent).toBe(
        `This secret will rotate every 6 hours, first at about ${expected}. Applications must pick up each new value.`
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it("updates with the interval", async () => {
    renderDetail(harness(NO_POLICY).client)
    await ready()
    setInterval("2", "days")
    expect(preview()!.textContent).toMatch(/rotate every 2 days,/)
  })

  it("hides when the enabled box is unchecked and returns when it is checked again", async () => {
    renderDetail(harness(NO_POLICY).client)
    await ready()
    fireEvent.click(enabledBox())
    expect(preview()).toBeNull()
    fireEvent.click(enabledBox())
    expect(preview()).toBeTruthy()
  })

  it("hides when the secret has no rotator", async () => {
    renderDetail(harness(detail({ policy: null, rotatable: false })).client)
    await ready()
    expect(preview()).toBeNull()
  })

  it("hides while the interval is not submittable", async () => {
    renderDetail(harness(NO_POLICY).client)
    await ready()
    setInterval("0.01", "hours")
    expect(preview()).toBeNull()
    fireEvent.change(interval(), { target: { value: "" } })
    expect(preview()).toBeNull()
  })
})

describe("RotationDetailPage rotate now", () => {
  it("is disabled with an explanation when no rotator is registered", async () => {
    renderDetail(harness(detail({ rotatable: false })).client)
    await ready()
    const button = screen.getByRole("button", { name: "Rotate now" }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    const why = screen.getByText(/No rotator is registered for this secret/)
    expect(why.textContent).toMatch(/registered in application code/)
    expect(button.getAttribute("aria-describedby")).toBe(why.id)
  })

  it("is enabled, with no explanation, when a rotator is registered", async () => {
    renderDetail(harness().client)
    await ready()
    const button = screen.getByRole("button", { name: "Rotate now" }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(screen.queryByText(/No rotator is registered/)).toBeNull()
  })

  it("asks for confirmation, sends only the key, and shows the version change", async () => {
    const h = harness(detail(), {
      "rotation.rotateNow": { key: KEY, oldVersion: 3, newVersion: 4 },
    })
    renderDetail(h.client)
    await ready()
    fireEvent.click(screen.getByRole("button", { name: "Rotate now" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toMatch(/creates a new version/)
    expect(dialog.textContent).toMatch(/Applications must pick up the new value/)
    expect(h.commands).toEqual([])
    fireEvent.click(within(dialog).getByRole("button", { name: "Rotate now" }))
    expect(await screen.findByText("Rotated from v3 to v4.")).toBeTruthy()
    expect(h.commands).toEqual([{ intent: "rotation.rotateNow", payload: { key: KEY } }])
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("shows a failure inside the dialog, keeps it open, and clears it on reopen", async () => {
    const h = failingCommands(new ContractError("INTERNAL", "rotator exploded"))
    renderDetail(h.client)
    await ready()
    fireEvent.click(screen.getByRole("button", { name: "Rotate now" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Rotate now" }))
    expect(await within(dialog).findByText(/rotator exploded/)).toBeTruthy()
    expect(screen.queryByText(/^Rotated from/)).toBeNull()
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Rotate now" }))
    const again = await screen.findByRole("alertdialog")
    expect(within(again).queryByText(/rotator exploded/)).toBeNull()
  })

  it("keeps the dialog open on Escape while the rotation runs", async () => {
    renderDetail(neverSettles().client)
    await ready()
    fireEvent.click(screen.getByRole("button", { name: "Rotate now" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Rotate now" }))
    await within(dialog).findByRole("button", { name: /Working/ })
    fireEvent.keyDown(dialog, { key: "Escape" })
    fireEvent.keyDown(document.body, { key: "Escape" })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole("alertdialog")).toBeTruthy()
  })

  it("still closes the rotate dialog on Escape when nothing is pending", async () => {
    renderDetail(harness().client)
    await ready()
    fireEvent.click(screen.getByRole("button", { name: "Rotate now" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })
})

describe("RotationDetailPage delete policy", () => {
  async function openDelete() {
    fireEvent.click(await screen.findByRole("button", { name: "Delete policy" }))
    return await screen.findByRole("alertdialog")
  }

  it("sends only the key after confirmation", async () => {
    const h = harness(detail(), { "rotation.deletePolicy": { ok: true, key: KEY } })
    renderDetail(h.client)
    const dialog = await openDelete()
    expect(h.commands).toEqual([])
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete policy" }))
    expect(await screen.findByText("Policy deleted.")).toBeTruthy()
    expect(h.commands).toEqual([{ intent: "rotation.deletePolicy", payload: { key: KEY } }])
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("shows a failure inside the dialog, keeps it open, and clears it on reopen", async () => {
    renderDetail(failingCommands(new ContractError("INTERNAL", "policy store down")).client)
    const dialog = await openDelete()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete policy" }))
    expect(await within(dialog).findByText(/policy store down/)).toBeTruthy()
    expect(screen.queryByText("Policy deleted.")).toBeNull()
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    const again = await openDelete()
    expect(within(again).queryByText(/policy store down/)).toBeNull()
  })

  it("keeps the dialog open on Escape while the delete runs", async () => {
    renderDetail(neverSettles().client)
    const dialog = await openDelete()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete policy" }))
    await within(dialog).findByRole("button", { name: /Working/ })
    fireEvent.keyDown(dialog, { key: "Escape" })
    fireEvent.keyDown(document.body, { key: "Escape" })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole("alertdialog")).toBeTruthy()
  })

  it("still closes on Escape when nothing is pending", async () => {
    renderDetail(harness().client)
    const dialog = await openDelete()
    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })
})

describe("RotationDetailPage history", () => {
  it("lists records with old and new version in mono, and counts them", async () => {
    renderDetail(harness(detail({ records: RECORDS })).client)
    await ready()
    expect(screen.getByText("2 rotations")).toBeTruthy()
    const first = screen.getByText("v3 → v4")
    expect(first.closest("td")?.className).toMatch(/font-mono/)
    expect(screen.getByText("v2 → v3")).toBeTruthy()
    const rows = screen.getAllByRole("row")
    const withUser = rows.find((r) => within(r).queryByText("v3 → v4"))!
    const without = rows.find((r) => within(r).queryByText("v2 → v3"))!
    expect(within(withUser).getByText("usr_1")).toBeTruthy()
    expect(within(without).getByLabelText("no user")).toBeTruthy()
  })

  it("uses the singular for one record", async () => {
    renderDetail(harness(detail({ records: [RECORDS[0]] })).client)
    await ready()
    expect(screen.getByText("1 rotation")).toBeTruthy()
  })

  it("says so and still counts when nothing has rotated", async () => {
    renderDetail(harness(detail({ records: null })).client)
    await ready()
    expect(screen.getByText("No rotations recorded yet.")).toBeTruthy()
    expect(screen.getByText("0 rotations")).toBeTruthy()
  })
})

describe("RotationDetailPage copy", () => {
  it("uses no em dash anywhere it renders", async () => {
    const h = harness(detail({ records: RECORDS, rotatable: false }))
    renderDetail(h.client)
    await ready()
    expect(document.body.textContent).not.toMatch(/—/)
  })
})
