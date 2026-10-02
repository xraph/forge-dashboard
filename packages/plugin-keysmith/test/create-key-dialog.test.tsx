import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
  NavigationProvider,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { CreateKeyDialog } from "../src/components/create-key-dialog"
import { keyPath } from "../src/format"
import type {
  KeySummary,
  KeyWithSecret,
  PoliciesList,
  ScopesList,
} from "../src/types"
import { recordingCommandClient } from "./harness"

// Obviously fake. A realistic-looking key never goes in a test.
const RAW_KEY = `sk_test_${"0123456789abcdef".repeat(2)}a3f8`

const CREATED: KeySummary = {
  id: "akey_new",
  name: "Billing service",
  prefix: "sk",
  hint: "a3f8",
  environment: "test",
  state: "active",
  effectiveState: "active",
  expiryPending: false,
  expiresSoon: false,
  scopes: [],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
}

const POLICIES: PoliciesList = {
  hasMore: false,
  policies: [
    {
      id: "kpol_standard",
      name: "Standard",
      maxKeyLifetimeSeconds: 90 * 86400,
      graceSeconds: 36 * 3600,
      allowedScopes: [],
    },
    {
      id: "kpol_short",
      name: "Short",
      maxKeyLifetimeSeconds: 7 * 86400,
      graceSeconds: null,
      allowedScopes: [],
    },
    {
      id: "kpol_narrow",
      name: "Narrow",
      maxKeyLifetimeSeconds: null,
      graceSeconds: null,
      allowedScopes: ["billing:read"],
    },
  ],
}

const SCOPES: ScopesList = {
  hasMore: false,
  scopes: [
    { id: "kscope_1", name: "billing:read" },
    { id: "kscope_2", name: "billing:write" },
    { id: "kscope_3", name: "reports:read" },
  ],
}

const WITH_SECRET: KeyWithSecret = { key: CREATED, rawKey: RAW_KEY }

// Only Date is faked, so timers and promises behave. A fixed local "now" lets
// the date bounds be written out: 10:00 on 2 October 2026, wherever this runs.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 9, 2, 10, 0, 0))
})

afterEach(() => {
  cleanup()
  queryStore.clear()
  vi.useRealTimers()
})

function Host({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open the dialog
      </button>
      <CreateKeyDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function mount(
  client: ScopedClient,
  options: { initiallyOpen?: boolean } = {}
) {
  const navigate = vi.fn()
  const view = render(
    <PluginProvider client={client}>
      <NavigationProvider
        value={{
          navigate,
          Link: ({ to, children }) => <a href={to}>{children}</a>,
        }}
      >
        <Host {...options} />
      </NavigationProvider>
    </PluginProvider>
  )
  return { ...view, navigate }
}

function standard(
  commandAnswer: unknown = WITH_SECRET,
  answers: Record<string, unknown> = {}
) {
  const base = recordingCommandClient(
    { "policies.list": POLICIES, "scopes.list": SCOPES, ...answers },
    { "keys.create": commandAnswer }
  )
  const queried: { intent: string; params?: unknown }[] = []
  const client = {
    extension: base.client.extension,
    command: base.client.command,
    query: (intent: string, params?: Record<string, unknown>) => {
      queried.push({ intent, params })
      return base.client.query(intent, params)
    },
  } as ScopedClient
  return { client, sent: base.sent, queried }
}

async function dialog(): Promise<HTMLElement> {
  return screen.findByRole("dialog")
}

function fill(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function createButton(): HTMLButtonElement {
  return within(screen.getByRole("dialog")).getByRole("button", {
    name: "Create key",
  }) as HTMLButtonElement
}

/** Fills the one required field and submits. */
async function submitNamed(name = "Billing service") {
  await dialog()
  fill("Name", name)
  fireEvent.click(createButton())
}

describe("CreateKeyDialog form", () => {
  it("opens titled Create key, with the documented defaults", async () => {
    const { client } = standard()
    mount(client)
    const d = await dialog()
    expect(within(d).getByText("Create key", { selector: "h2" })).toBeTruthy()
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("")
    expect(
      (screen.getByRole("radio", { name: "Test" }) as HTMLElement).getAttribute(
        "aria-checked"
      )
    ).toBe("true")
    expect((screen.getByLabelText("Prefix") as HTMLInputElement).value).toBe(
      "sk"
    )
    expect((screen.getByLabelText("Policy") as HTMLSelectElement).value).toBe(
      ""
    )
  })

  it("previews the key's shape from the prefix and environment", async () => {
    const { client } = standard()
    mount(client)
    await dialog()
    expect(screen.getByText("sk_test_…")).toBeTruthy()
    fill("Prefix", "whk")
    fireEvent.click(screen.getByRole("radio", { name: "Staging" }))
    expect(screen.getByText("whk_staging_…")).toBeTruthy()
  })

  it("offers every policy and says what the chosen one allows", async () => {
    const { client } = standard()
    mount(client)
    await dialog()
    await screen.findByRole("option", { name: "Standard" })
    const options = within(screen.getByLabelText("Policy"))
      .getAllByRole("option")
      .map((o) => o.textContent)
    expect(options).toEqual(["No policy", "Standard", "Short", "Narrow"])

    fill("Policy", "kpol_standard")
    expect(screen.getByText(/Maximum lifetime: 90 days/)).toBeTruthy()
    expect(screen.getByText(/Grace period: 36 hours/)).toBeTruthy()
    expect(
      screen.getByText(
        "Keys under this policy expire after 90 days unless you choose an earlier date."
      )
    ).toBeTruthy()

    fill("Policy", "kpol_narrow")
    expect(screen.getByText(/Maximum lifetime: No maximum/)).toBeTruthy()
    expect(screen.getByText(/Grace period: Not set/)).toBeTruthy()
    expect(screen.queryByText(/expire after/)).toBeNull()
  })

  it("narrows the scopes to the chosen policy's allowed scopes", async () => {
    const { client } = standard()
    mount(client)
    await dialog()
    await screen.findByRole("checkbox", { name: "reports:read" })
    expect(screen.getAllByRole("checkbox")).toHaveLength(3)

    fill("Policy", "kpol_narrow")
    expect(screen.getAllByRole("checkbox")).toHaveLength(1)
    expect(screen.getByRole("checkbox", { name: "billing:read" })).toBeTruthy()
    expect(
      screen.getByText("Only the scopes this policy allows are listed.")
    ).toBeTruthy()

    fill("Policy", "")
    expect(screen.getAllByRole("checkbox")).toHaveLength(3)
    expect(screen.queryByText(/Only the scopes this policy allows/)).toBeNull()
  })

  it("drops a ticked scope the chosen policy does not allow", async () => {
    const { client, sent } = standard()
    mount(client)
    await dialog()
    fireEvent.click(await screen.findByRole("checkbox", { name: "billing:write" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "billing:read" }))
    fill("Policy", "kpol_narrow")
    fill("Name", "Narrow key")
    fireEvent.click(createButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0].payload as { scopes: string[] }).scopes).toEqual([
      "billing:read",
    ])
  })
})

describe("CreateKeyDialog submit", () => {
  it("sends every field to keys.create", async () => {
    const { client, sent } = standard()
    mount(client)
    await dialog()
    await screen.findByRole("checkbox", { name: "billing:write" })

    fill("Name", "  Billing service  ")
    fill("Description", "Charges the cards")
    fireEvent.click(screen.getByRole("radio", { name: "Staging" }))
    fill("Prefix", "bill")
    fill("Policy", "kpol_standard")
    fill(/^Expiry/, "2026-12-15")
    fireEvent.click(screen.getByRole("checkbox", { name: "billing:write" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "billing:read" }))
    fireEvent.click(createButton())

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].intent).toBe("keys.create")
    expect(sent[0].payload).toEqual({
      name: "Billing service",
      description: "Charges the cards",
      environment: "staging",
      prefix: "bill",
      policyId: "kpol_standard",
      // The operator's local end of that day, computed the way a person
      // would read it, not as a UTC literal.
      expiresAt: new Date(2026, 11, 15, 23, 59, 59).toISOString(),
      scopes: ["billing:read", "billing:write"],
    })
  })

  it("leaves out what was not filled in", async () => {
    const { client, sent } = standard()
    mount(client)
    await submitNamed()
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toEqual({
      name: "Billing service",
      environment: "test",
      prefix: "sk",
      scopes: [],
    })
  })

  it("refuses an empty name and a bad prefix before asking the server", async () => {
    const { client, sent } = standard()
    mount(client)
    await dialog()

    fireEvent.click(createButton())
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe(
      "name is required"
    )

    fill("Name", "x".repeat(201))
    fireEvent.click(createButton())
    expect(screen.getByRole("alert").textContent).toBe("name is too long")

    fill("Name", "Fine")
    fill("Prefix", "Bad_Prefix")
    fireEvent.click(createButton())
    expect(screen.getByRole("alert").textContent).toBe(
      "prefix must be 2 to 16 lowercase letters or digits, starting with a letter"
    )
    expect(sent).toHaveLength(0)
  })

  it("shows a server error inside the dialog and keeps the form", async () => {
    const { client } = standard()
    const failing = {
      extension: client.extension,
      query: client.query,
      command: async () => {
        throw new ContractError("BAD_REQUEST", "policy not found")
      },
    } as ScopedClient
    mount(failing)
    await submitNamed("Keep me")

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe("policy not found")
    expect(screen.getByRole("dialog").contains(alert)).toBe(true)
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Keep me"
    )
    expect(createButton().disabled).toBe(false)
  })

  it("marks the prefix invalid when the server says so, and points at the error", async () => {
    const { client } = standard()
    const prefixMessage =
      "prefix must be 2 to 16 lowercase letters or digits, starting with a letter"
    const failing = {
      extension: client.extension,
      query: client.query,
      command: async () => {
        throw new ContractError("BAD_REQUEST", prefixMessage)
      },
    } as ScopedClient
    mount(failing)
    await dialog()
    fill("Name", "Fine")
    // Valid here, so only the server can refuse it.
    fireEvent.click(createButton())

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe(prefixMessage)
    const prefix = screen.getByLabelText("Prefix")
    expect(prefix.getAttribute("aria-invalid")).toBe("true")
    expect(prefix.getAttribute("aria-describedby")).toBe(alert.id)
    expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBeNull()
  })

  it("marks the name invalid for the name messages", async () => {
    const { client } = standard()
    mount(client)
    await dialog()
    fireEvent.click(createButton())
    const alert = screen.getByRole("alert")
    const name = screen.getByLabelText("Name")
    expect(name.getAttribute("aria-invalid")).toBe("true")
    expect(name.getAttribute("aria-describedby")).toBe(alert.id)
    expect(screen.getByLabelText("Prefix").getAttribute("aria-invalid")).toBeNull()
  })

  it("sends one command however many times Create is pressed while pending", async () => {
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
    await submitNamed()

    await waitFor(() => expect(createButton().disabled).toBe(true))
    fireEvent.click(createButton())
    fireEvent.click(createButton())
    expect(base.sent).toHaveLength(1)

    // Escape does not close a dialog whose key is still being made: the
    // answer would arrive with nowhere to show it.
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(screen.getByRole("dialog")).toBeTruthy()

    release(WITH_SECRET)
    await screen.findByText("This is the only time Keysmith will show it.")
  })
})

describe("CreateKeyDialog expiry", () => {
  const expiry = () => screen.getByLabelText(/^Expiry/) as HTMLInputElement

  it("bounds the date from today, and by a policy's maximum lifetime", async () => {
    const { client } = standard()
    mount(client)
    await dialog()
    await screen.findByRole("option", { name: "Standard" })
    expect(expiry().min).toBe("2026-10-02")
    expect(expiry().max).toBe("")

    // 90 days from 10:00 on 2 Oct is 10:00 on 31 Dec, so the 31st's end of day
    // is past it and 30 Dec is the last date that fits.
    fill("Policy", "kpol_standard")
    expect(expiry().min).toBe("2026-10-02")
    expect(expiry().max).toBe("2026-12-30")

    fill("Policy", "kpol_short")
    expect(expiry().max).toBe("2026-10-08")

    fill("Policy", "kpol_narrow")
    expect(expiry().max).toBe("")
  })

  // The invariant behind `max`, written with its own local arithmetic: the
  // last date whose local end of day is not after now + lifetime. It must hold
  // in every zone, and across clock changes, where a day is 23 or 25 hours.
  async function maxFor(now: Date, policy: string): Promise<string> {
    vi.setSystemTime(now)
    queryStore.clear()
    const { client } = standard()
    const view = mount(client)
    await dialog()
    await screen.findByRole("option", { name: "Standard" })
    fill("Policy", policy)
    const max = (screen.getByLabelText(/^Expiry/) as HTMLInputElement).max
    view.unmount()
    return max
  }

  function endOfDay(value: string, plusDays = 0): number {
    const [y, m, d] = value.split("-").map(Number)
    return new Date(y, m - 1, d + plusDays, 23, 59, 59).getTime()
  }

  it("never allows a date whose end of day is past now plus the lifetime", async () => {
    // 90 days from 3 Aug 10:00 lands on 1 Nov, the fall-back day in the US
    // (25 hours long); the same arithmetic also crosses spring and autumn
    // changes in the southern zones. The first case is the one that broke.
    // 90 days from 5 Jan 10:00 is the southern fall-back day, 5 Apr.
    const opened: Date[] = [
      new Date(2026, 7, 3, 10, 0, 0),
      new Date(2026, 0, 5, 10, 0, 0),
      new Date(2026, 0, 5, 23, 30, 0),
    ]
    for (let day = 0; day < 365; day += 7) {
      for (const hour of [10, 23]) {
        opened.push(new Date(2026, 0, 1 + day, hour, 30, 0))
      }
    }
    const lifetimes = { kpol_standard: 90 * 86400, kpol_short: 7 * 86400 }
    for (const now of opened) {
      for (const [policy, seconds] of Object.entries(lifetimes)) {
        const limit = now.getTime() + seconds * 1000
        const max = await maxFor(now, policy)
        const label = `${now.toString()} ${policy} -> ${max}`
        expect(endOfDay(max) <= limit, label).toBe(true)
        // And it is the latest such date, so a valid day is not given up.
        expect(endOfDay(max, 1) > limit, label).toBe(true)
      }
    }
  }, 60_000)

  it("clears a date the newly chosen policy would refuse", async () => {
    const { client } = standard()
    mount(client)
    await dialog()
    await screen.findByRole("option", { name: "Standard" })
    fill("Policy", "kpol_standard")
    fill(/^Expiry/, "2026-12-15")
    expect(expiry().value).toBe("2026-12-15")

    fill("Policy", "kpol_short")
    expect(expiry().value).toBe("")

    // A date that still fits stays.
    fill(/^Expiry/, "2026-10-05")
    fill("Policy", "kpol_standard")
    expect(expiry().value).toBe("2026-10-05")
  })

  it("says when the key will expire, in the operator's time", async () => {
    const { client } = standard()
    mount(client)
    await dialog()
    expect(screen.queryByText(/Expires at the end of/)).toBeNull()
    fill(/^Expiry/, "2026-12-15")
    const long = new Date(2026, 11, 15).toLocaleDateString(undefined, {
      dateStyle: "long",
    })
    expect(
      screen.getByText(`Expires at the end of ${long}, your time.`)
    ).toBeTruthy()
  })

  it("accepts today, as the end of the operator's day", async () => {
    const { client, sent } = standard()
    mount(client)
    await dialog()
    fill("Name", "Today")
    fill(/^Expiry/, "2026-10-02")
    fireEvent.click(createButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0].payload as { expiresAt: string }).expiresAt).toBe(
      new Date(2026, 9, 2, 23, 59, 59).toISOString()
    )
  })

  it("refuses a date before today next to the field, without sending", async () => {
    const { client, sent } = standard()
    mount(client)
    await dialog()
    fill("Name", "Yesterday")
    fill(/^Expiry/, "2026-10-01")
    fireEvent.click(createButton())

    const note = screen.getByText("Choose today or a later date.")
    expect(note.closest("[data-slot=field]")?.contains(expiry())).toBe(true)
    expect(expiry().getAttribute("aria-invalid")).toBe("true")
    expect(expiry().getAttribute("aria-describedby")).toBe(note.id)
    expect(sent).toHaveLength(0)

    // Choosing another date takes the message away.
    fill(/^Expiry/, "2026-10-03")
    expect(screen.queryByText("Choose today or a later date.")).toBeNull()
  })
})

describe("CreateKeyDialog pickers", () => {
  it("asks each picker for 200", async () => {
    const { client, queried } = standard()
    mount(client)
    await dialog()
    await screen.findByRole("option", { name: "Standard" })
    expect(queried).toContainEqual({
      intent: "policies.list",
      params: { limit: 200 },
    })
    expect(queried).toContainEqual({
      intent: "scopes.list",
      params: { limit: 200 },
    })
  })

  it("says when there are more policies than the picker shows", async () => {
    const { client } = standard(WITH_SECRET, {
      "policies.list": { ...POLICIES, hasMore: true },
    })
    mount(client)
    await dialog()
    expect(
      await screen.findByText("Only the first 200 policies are listed.")
    ).toBeTruthy()
  })

  it("says when there are more scopes than the picker shows", async () => {
    const { client } = standard(WITH_SECRET, {
      "scopes.list": { ...SCOPES, hasMore: true },
    })
    mount(client)
    await dialog()
    expect(
      await screen.findByText(
        "Only the first 200 scopes are listed. You can add others from the key's page after it is created."
      )
    ).toBeTruthy()
  })

  it("blames the first 200 when a policy allows none of the scopes shown", async () => {
    const { client } = standard(WITH_SECRET, {
      "scopes.list": {
        hasMore: true,
        scopes: [{ id: "kscope_9", name: "reports:read" }],
      },
    })
    mount(client)
    await dialog()
    await screen.findByRole("checkbox", { name: "reports:read" })
    await screen.findByRole("option", { name: "Narrow" })
    fill("Policy", "kpol_narrow")
    expect(
      screen.getByText("None of the first 200 scopes are allowed by this policy.")
    ).toBeTruthy()
    expect(
      screen.queryByText("This policy allows none of the scopes that exist.")
    ).toBeNull()
  })

  it("says a policy allows none of the scopes that exist when the list is complete", async () => {
    const { client } = standard(WITH_SECRET, {
      "scopes.list": {
        hasMore: false,
        scopes: [{ id: "kscope_9", name: "reports:read" }],
      },
    })
    mount(client)
    await dialog()
    await screen.findByRole("checkbox", { name: "reports:read" })
    await screen.findByRole("option", { name: "Narrow" })
    fill("Policy", "kpol_narrow")
    expect(
      screen.getByText("This policy allows none of the scopes that exist.")
    ).toBeTruthy()
  })
})

describe("CreateKeyDialog reveal", () => {
  it("shows the key once, under a single accessible name", async () => {
    const { client } = standard()
    mount(client)
    await submitNamed()

    const d = await dialog()
    await within(d).findByText("This is the only time Keysmith will show it.")
    expect(d.textContent).toContain(RAW_KEY)
    expect(within(d).queryAllByRole("heading")).toHaveLength(1)
    expect(
      screen.getByRole("dialog", { name: "Save your new key" })
    ).toBeTruthy()
    // The form is gone.
    expect(screen.queryByLabelText("Name")).toBeNull()
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull()
  })

  it("does not close on Escape or an outside click while the key is up", async () => {
    const { client } = standard()
    mount(client)
    await submitNamed()
    await screen.findByText("This is the only time Keysmith will show it.")

    fireEvent.keyDown(document.body, { key: "Escape" })
    fireEvent.pointerDown(document.body)
    fireEvent.mouseDown(document.body)
    fireEvent.click(document.body)
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(screen.getByRole("dialog").textContent).toContain(RAW_KEY)
  })

  it("forgets the key after Done and goes to the new key's page", async () => {
    const { client } = standard()
    const { navigate } = mount(client)
    await submitNamed()
    await screen.findByText("This is the only time Keysmith will show it.")

    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Done" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith(keyPath("akey_new"))

    expect(document.body.textContent).not.toContain(RAW_KEY)
    // Reaches into a private field on purpose: the query store has no public
    // listing, and "the raw key is in no cache" is exactly the property that
    // matters here. Every record is serialised, so a key stored anywhere in
    // an entry would show.
    const records = (queryStore as unknown as { records: Map<string, unknown> })
      .records
    expect(records.size).toBeGreaterThan(0)
    expect(JSON.stringify([...records.values()])).not.toContain(RAW_KEY)
  })

  it("clears the form when it is closed before sending", async () => {
    const { client, sent } = standard()
    mount(client)
    await dialog()
    fill("Name", "Half written")
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    fireEvent.click(screen.getByRole("button", { name: "Open the dialog" }))
    await dialog()
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("")
    expect(sent).toHaveLength(0)
  })

  it("closes on Escape before anything is sent", async () => {
    const { client } = standard()
    mount(client)
    await dialog()
    fireEvent.keyDown(document.body, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })
})
