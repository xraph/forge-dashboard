import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  act,
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
import { recordingCommandClient, secretCommandClient } from "./harness"

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
  rateLimiterConfigured: false,
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

/**
 * A client whose lists can change under the form, the way they do when the
 * operator switches org in another tab and comes back. After `switchTo`, every
 * read answers the new lists, but only once the test calls `release`, so the
 * test can press Create while they are still blank.
 */
function switchingClient() {
  const sent: { intent: string; payload: unknown }[] = []
  let answers: Record<string, unknown> = {
    "policies.list": POLICIES,
    "scopes.list": SCOPES,
  }
  let hold = false
  const held: (() => void)[] = []
  const client = {
    extension: "keysmith",
    query: (intent: string) => {
      const answer = answers[intent]
      if (!hold) return Promise.resolve(answer)
      return new Promise((resolve) => held.push(() => resolve(answer)))
    },
    command: async (intent: string, payload?: unknown) => {
      sent.push({ intent, payload })
      return WITH_SECRET
    },
  } as unknown as ScopedClient
  return {
    client,
    sent,
    switchTo(next: Record<string, unknown>) {
      answers = { ...answers, ...next }
      hold = true
    },
    release() {
      hold = false
      for (const r of held.splice(0)) r()
    },
  }
}

describe("CreateKeyDialog across a context switch", () => {
  it("will not create while the lists reload, then says which picks are gone", async () => {
    const host = switchingClient()
    mount(host.client)
    await dialog()
    fireEvent.click(await screen.findByRole("checkbox", { name: "billing:write" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "reports:read" }))
    fill("Policy", "kpol_standard")
    fill("Name", "Billing service")

    // The other org has reports:read but not billing:write, and no Standard.
    host.switchTo({
      "scopes.list": {
        hasMore: false,
        scopes: [
          { id: "kscope_7", name: "billing:read" },
          { id: "kscope_8", name: "reports:read" },
        ],
      },
      "policies.list": { ...POLICIES, policies: [POLICIES.policies[1]] },
    })
    act(() => queryStore.clear())

    expect(createButton().disabled).toBe(true)
    fireEvent.click(createButton())
    // A click already on its way reaches the submit handler, not the button.
    fireEvent.submit(createButton().closest("form")!)
    await act(async () => {})
    expect(host.sent).toHaveLength(0)

    act(() => host.release())
    expect(
      await screen.findByText(
        "Some of your picks are no longer listed and came off the form: billing:write and the Standard policy."
      )
    ).toBeTruthy()
    expect(
      screen.getByRole("checkbox", { name: "reports:read" }).getAttribute("aria-checked")
    ).toBe("true")
    expect(
      screen.getByRole("checkbox", { name: "billing:read" }).getAttribute("aria-checked")
    ).toBe("false")
    expect((screen.getByLabelText("Policy") as HTMLSelectElement).value).toBe("")
    expect(createButton().disabled).toBe(false)

    // Having read that, the operator creates with what is left.
    fireEvent.click(createButton())
    await waitFor(() => expect(host.sent).toHaveLength(1))
    expect(host.sent[0].payload).toEqual({
      name: "Billing service",
      environment: "test",
      prefix: "sk",
      scopes: ["reports:read"],
    })
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
  //
  // Mounting the dialog is what costs: a full render with its query provider,
  // and this sweep needs a few hundred "now" values. So the page is mounted
  // once, and each "now" closes and reopens the dialog, which remounts the
  // form and so reads the clock afresh. Both policies are read off the same
  // opening. The policies come from the query cache after the first answer.
  async function sweep(
    opened: Date[],
    policies: string[],
    check: (now: Date, policy: string, max: string) => void
  ) {
    const { client } = standard()
    // The first opening reads the clock as it mounts.
    vi.setSystemTime(opened[0])
    mount(client)
    await dialog()
    await screen.findByRole("option", { name: "Standard" })
    let first = true
    for (const now of opened) {
      vi.setSystemTime(now)
      if (!first) {
        fireEvent.keyDown(document.body, { key: "Escape" })
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
        fireEvent.click(screen.getByText("Open the dialog"))
        await dialog()
        await screen.findByRole("option", { name: "Standard" })
      }
      first = false
      for (const policy of policies) {
        fill("Policy", policy)
        check(
          now,
          policy,
          (screen.getByLabelText(/^Expiry/) as HTMLInputElement).max
        )
      }
    }
  }

  function endOfDay(value: string, plusDays = 0): number {
    const [y, m, d] = value.split("-").map(Number)
    return new Date(y, m - 1, d + plusDays, 23, 59, 59).getTime()
  }

  it("never allows a date whose end of day is past now plus the lifetime", async () => {
    // The package pins TZ to America/Chicago (vitest.config.ts). In a zone
    // with no clock change this test would pass without testing anything.
    const winter = new Date(2026, 0, 15).getTimezoneOffset()
    const summer = new Date(2026, 6, 15).getTimezoneOffset()
    expect(winter, "the test zone must observe daylight saving").not.toBe(summer)

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
    const lifetimes: Record<string, number> = {
      kpol_standard: 90 * 86400,
      kpol_short: 7 * 86400,
    }
    await sweep(opened, Object.keys(lifetimes), (now, policy, max) => {
      const limit = now.getTime() + lifetimes[policy] * 1000
      const label = `${now.toString()} ${policy} -> ${max}`
      expect(endOfDay(max) <= limit, label).toBe(true)
      // And it is the latest such date, so a valid day is not given up.
      expect(endOfDay(max, 1) > limit, label).toBe(true)
    })
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
    const long = new Date(2026, 11, 15).toLocaleDateString(undefined, {
      dateStyle: "long",
    })
    const cleared = `${long} is later than this policy allows, so the date was cleared.`
    expect(screen.getByText(cleared)).toBeTruthy()

    // A date that still fits stays, and the note goes once a date is chosen.
    fill(/^Expiry/, "2026-10-05")
    expect(screen.queryByText(cleared)).toBeNull()
    fill("Policy", "kpol_standard")
    expect(expiry().value).toBe("2026-10-05")
    expect(screen.queryByText(/so the date was cleared/)).toBeNull()
  })

  it("drops the cleared-date note when another policy is chosen", async () => {
    const { client } = standard()
    mount(client)
    await dialog()
    await screen.findByRole("option", { name: "Standard" })
    fill("Policy", "kpol_standard")
    fill(/^Expiry/, "2026-12-15")
    fill("Policy", "kpol_short")
    expect(screen.getByText(/so the date was cleared/)).toBeTruthy()
    fill("Policy", "")
    expect(screen.queryByText(/so the date was cleared/)).toBeNull()
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

  it("keeps the key up through a context switch, and sends keys.create once", async () => {
    const { client, sent } = standard()
    mount(client)
    await submitNamed()
    await screen.findByText("This is the only time Keysmith will show it.")

    // The lists under the dialog blank and reload for the new context.
    act(() => queryStore.clear())
    expect(screen.getByRole("dialog").textContent).toContain(RAW_KEY)
    await act(async () => {})
    expect(screen.getByRole("dialog").textContent).toContain(RAW_KEY)
    expect(sent.filter((s) => s.intent === "keys.create")).toHaveLength(1)
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

  it("shows only its title while it closes after Done, never the form or the key", async () => {
    // The dialog stays mounted through its exit animation. Holding `open`
    // true after Done freezes that moment, which jsdom would otherwise skip.
    const { client } = standard()
    const onOpenChange = vi.fn()
    const navigate = vi.fn()
    render(
      <PluginProvider client={client}>
        <NavigationProvider
          value={{
            navigate,
            Link: ({ to, children }) => <a href={to}>{children}</a>,
          }}
        >
          <CreateKeyDialog open onOpenChange={onOpenChange} />
        </NavigationProvider>
      </PluginProvider>
    )
    await submitNamed()
    await screen.findByText("This is the only time Keysmith will show it.")
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Done" }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(navigate).toHaveBeenCalledWith(keyPath("akey_new"))
    const d = screen.getByRole("dialog", { name: "Save your new key" })
    expect(d.textContent).not.toContain(RAW_KEY)
    expect(within(d).queryByRole("textbox")).toBeNull()
    expect(within(d).queryByLabelText("Name")).toBeNull()
    expect(within(d).queryByRole("button")).toBeNull()
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

/** Every record in the query store, serialised. See the Done test above. */
function storeText(): string {
  const records = (queryStore as unknown as { records: Map<string, unknown> })
    .records
  return JSON.stringify([...records.values()])
}

function secretServer() {
  return secretCommandClient(
    { "policies.list": POLICIES, "scopes.list": SCOPES },
    { "keys.create": WITH_SECRET }
  )
}

const LOST =
  "The server's answer didn't arrive, so your key may have been created. Check the key list before you try again. If it isn't there, pressing Create key again from this form, with nothing changed, is the safest retry."
const SPENT =
  "Your key was created, but its secret can't be shown again. Revoke it from the key list, then create it again."

describe("CreateKeyDialog idempotency", () => {
  it("sends the same key again after the answer was lost, so the server can recognise the retry", async () => {
    const server = secretServer()
    mount(server.client)
    await screen.findByRole("checkbox", { name: "billing:read" })
    server.loseNextAnswer()
    await submitNamed()

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe(LOST)
    expect(
      within(alert).getByRole("link", { name: "key list" }).getAttribute("href")
    ).toBe("/keys")
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Billing service"
    )

    // The first one did run. Pressing again is the same command, and the
    // server says so rather than minting another key.
    fireEvent.click(createButton())
    await waitFor(() => expect(server.sent).toHaveLength(2))
    expect(server.sent[0].idempotencyKey).toBeTruthy()
    expect(server.sent[1].idempotencyKey).toBe(server.sent[0].idempotencyKey)
    expect(server.ran["keys.create"]).toBe(1)
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(SPENT))
  })

  it("counts a fetch that failed outright as a lost answer", async () => {
    const base = secretServer()
    const client = {
      extension: base.client.extension,
      query: base.client.query,
      command: async () => {
        throw new TypeError("Failed to fetch")
      },
    } as ScopedClient
    mount(client)
    await screen.findByRole("checkbox", { name: "billing:read" })
    await submitNamed()
    expect((await screen.findByRole("alert")).textContent).toBe(LOST)
  })

  it("mints a new key once an edit changes what would be sent", async () => {
    const server = secretServer()
    mount(server.client)
    await screen.findByRole("checkbox", { name: "billing:read" })
    server.loseNextAnswer()
    await submitNamed("Billing service")
    await screen.findByRole("alert")

    fill("Name", "Billing worker")
    fireEvent.click(createButton())
    await screen.findByText("This is the only time Keysmith will show it.")
    expect(server.sent).toHaveLength(2)
    expect(server.sent[1].idempotencyKey).not.toBe(server.sent[0].idempotencyKey)
    expect(server.ran["keys.create"]).toBe(2)
  })

  it("keeps the key when an edit is put back the way it was sent", async () => {
    const server = secretServer()
    mount(server.client)
    await screen.findByRole("checkbox", { name: "billing:read" })
    server.loseNextAnswer()
    await submitNamed("Billing service")
    await screen.findByRole("alert")

    fill("Name", "Billing worker")
    fill("Name", "Billing service")
    fireEvent.click(createButton())
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(SPENT))
    expect(server.sent[1].idempotencyKey).toBe(server.sent[0].idempotencyKey)
  })

  it("explains a create that already ran, with no raw key in the page or the store", async () => {
    const server = secretServer()
    mount(server.client)
    await screen.findByRole("checkbox", { name: "billing:read" })
    server.loseNextAnswer()
    await submitNamed()
    await screen.findByRole("alert")
    fireEvent.click(createButton())

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(SPENT))
    const alert = screen.getByRole("alert")
    expect(alert.textContent).not.toContain("CONFLICT")
    expect(alert.textContent).not.toContain("idempotency")
    expect(
      within(alert).getByRole("link", { name: "key list" }).getAttribute("href")
    ).toBe("/keys")
    expect(document.body.textContent).not.toContain(RAW_KEY)
    expect(storeText()).not.toContain(RAW_KEY)
    expect(createButton().disabled).toBe(false)
  })

  it("starts a new command after the server said the old one already ran", async () => {
    const server = secretServer()
    mount(server.client)
    await screen.findByRole("checkbox", { name: "billing:read" })
    server.loseNextAnswer()
    await submitNamed()
    await screen.findByRole("alert")
    fireEvent.click(createButton())
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(SPENT))

    // Read, revoked, and now asked for on purpose.
    fireEvent.click(createButton())
    await screen.findByText("This is the only time Keysmith will show it.")
    expect(server.sent).toHaveLength(3)
    expect(server.sent[2].idempotencyKey).not.toBe(server.sent[0].idempotencyKey)
    expect(server.ran["keys.create"]).toBe(2)
  })

  it("shows keysmith's own CONFLICT as it is, and keeps the key", async () => {
    const base = secretServer()
    const keys: (string | undefined)[] = []
    const client = {
      extension: base.client.extension,
      query: base.client.query,
      command: async (
        _intent: string,
        _payload?: unknown,
        opts?: { idempotencyKey?: string }
      ) => {
        keys.push(opts?.idempotencyKey)
        throw new ContractError(
          "CONFLICT",
          "this key changed while you were acting on it. Reload and try again."
        )
      },
    } as ScopedClient
    mount(client)
    await screen.findByRole("checkbox", { name: "billing:read" })
    await submitNamed()
    expect((await screen.findByRole("alert")).textContent).toBe(
      "this key changed while you were acting on it. Reload and try again."
    )
    fireEvent.click(createButton())
    await waitFor(() => expect(keys).toHaveLength(2))
    expect(keys[1]).toBe(keys[0])
  })

  it("mints a new key after a context switch", async () => {
    const server = secretServer()
    mount(server.client)
    await screen.findByRole("checkbox", { name: "billing:read" })
    server.loseNextAnswer()
    await submitNamed()
    await screen.findByRole("alert")

    // The same form in another tenant is another command.
    act(() => queryStore.clear())
    await waitFor(() => expect(createButton().disabled).toBe(false))
    fireEvent.click(createButton())
    await screen.findByText("This is the only time Keysmith will show it.")
    expect(server.sent[1].idempotencyKey).not.toBe(server.sent[0].idempotencyKey)
  })

  it("mints a new key once the dialog is closed and opened again", async () => {
    const server = secretServer()
    mount(server.client)
    await screen.findByRole("checkbox", { name: "billing:read" })
    server.loseNextAnswer()
    await submitNamed()
    await screen.findByRole("alert")
    // The dialog unlocks in an effect after the error renders. Its Close
    // button comes back with it, and a Cancel before then is refused.
    await screen.findByRole("button", { name: "Close" })

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Open the dialog" }))
    await screen.findByRole("checkbox", { name: "billing:read" })
    await submitNamed()
    await screen.findByText("This is the only time Keysmith will show it.")
    expect(server.sent[1].idempotencyKey).not.toBe(server.sent[0].idempotencyKey)
  })

  it("mints a new key for the next key after a reveal", async () => {
    const server = secretServer()
    mount(server.client)
    await screen.findByRole("checkbox", { name: "billing:read" })
    await submitNamed()
    await screen.findByText("This is the only time Keysmith will show it.")
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    fireEvent.click(screen.getByRole("button", { name: "Open the dialog" }))
    await screen.findByRole("checkbox", { name: "billing:read" })
    await submitNamed()
    await screen.findByText("This is the only time Keysmith will show it.")
    expect(server.sent[1].idempotencyKey).not.toBe(server.sent[0].idempotencyKey)
    expect(server.ran["keys.create"]).toBe(2)
  })

  it("closes the dialog when the key list link is followed", async () => {
    const server = secretServer()
    mount(server.client)
    await screen.findByRole("checkbox", { name: "billing:read" })
    server.loseNextAnswer()
    await submitNamed()
    const alert = await screen.findByRole("alert")
    // The stand-in Link is a bare anchor, and jsdom cannot navigate.
    document.addEventListener("click", (e) => e.preventDefault(), { once: true })
    fireEvent.click(within(alert).getByRole("link", { name: "key list" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("keeps the key while the first create is still running, then says it already ran", async () => {
    const server = secretServer()
    mount(server.client)
    await screen.findByRole("checkbox", { name: "billing:read" })
    server.holdNextRun()
    server.loseNextAnswer()
    await submitNamed()
    expect((await screen.findByRole("alert")).textContent).toBe(LOST)

    // The first send is still out on the server.
    fireEvent.click(createButton())
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Your earlier attempt is still finishing, so try again in a moment."
      )
    )
    server.finishRuns()
    fireEvent.click(createButton())
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(SPENT))
    expect(server.sent.map((s) => s.idempotencyKey)).toEqual([
      server.sent[0].idempotencyKey,
      server.sent[0].idempotencyKey,
      server.sent[0].idempotencyKey,
    ])
    expect(server.ran["keys.create"]).toBe(1)
    expect(document.body.textContent).not.toContain(RAW_KEY)
  })

  it("keeps the key when the server could not claim it, and says to try again", async () => {
    const base = secretServer()
    const keys: (string | undefined)[] = []
    const client = {
      extension: base.client.extension,
      query: base.client.query,
      command: async (
        intent: string,
        payload?: unknown,
        opts?: { idempotencyKey?: string }
      ) => {
        keys.push(opts?.idempotencyKey)
        if (keys.length === 1) {
          throw new ContractError("UNAVAILABLE", "could not claim the idempotency key")
        }
        return base.client.command(intent, payload, opts)
      },
    } as ScopedClient
    mount(client)
    await screen.findByRole("checkbox", { name: "billing:read" })
    await submitNamed()
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The server couldn't take this just now. Try again in a moment."
    )
    fireEvent.click(createButton())
    await screen.findByText("This is the only time Keysmith will show it.")
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })
})

/**
 * The secret server's commands, with lists the test can fail or reorder
 * before the next read.
 */
function listServer() {
  const server = secretServer()
  let scopes: ScopesList | Error = SCOPES
  let policies: PoliciesList | Error = POLICIES
  const client = {
    extension: server.client.extension,
    command: server.client.command,
    query: async (intent: string, params?: Record<string, unknown>) => {
      if (intent === "scopes.list") {
        if (scopes instanceof Error) throw scopes
        return scopes
      }
      if (intent === "policies.list") {
        if (policies instanceof Error) throw policies
        return policies
      }
      return server.client.query(intent, params)
    },
  } as ScopedClient
  return {
    ...server,
    client,
    answerScopes(next: ScopesList | Error) {
      scopes = next
    },
    answerPolicies(next: PoliciesList | Error) {
      policies = next
    },
  }
}

describe("CreateKeyDialog idempotency across list reloads", () => {
  it("keeps the key when a failed scopes read is read again", async () => {
    const server = listServer()
    mount(server.client)
    await screen.findByRole("checkbox", { name: "billing:read" })
    server.loseNextAnswer()
    await submitNamed()
    expect((await screen.findByRole("alert")).textContent).toBe(LOST)

    // The tab comes back and the scopes read fails, which drops its data.
    server.answerScopes(
      new ContractError("TRANSPORT", "contract request failed with HTTP 502")
    )
    await act(async () => queryStore.revalidate())
    // Again: loading with no data, but with the error beside it. That is not
    // a context switch.
    server.answerScopes(SCOPES)
    await act(async () => queryStore.revalidate())
    await waitFor(() => expect(createButton().disabled).toBe(false))

    fireEvent.click(createButton())
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(SPENT))
    expect(server.sent[1].idempotencyKey).toBe(server.sent[0].idempotencyKey)
    expect(server.ran["keys.create"]).toBe(1)
  })

  it("keeps the key when the scopes come back in another order", async () => {
    const server = listServer()
    mount(server.client)
    fireEvent.click(await screen.findByRole("checkbox", { name: "billing:read" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "reports:read" }))
    server.loseNextAnswer()
    await submitNamed()
    await screen.findByRole("alert")

    server.answerScopes({ ...SCOPES, scopes: [...SCOPES.scopes].reverse() })
    await act(async () => queryStore.revalidate())
    await waitFor(() =>
      expect(
        screen.getAllByRole("checkbox").map((c) => c.closest("label")?.textContent)
      ).toEqual(["reports:read", "billing:write", "billing:read"])
    )

    fireEvent.click(createButton())
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(SPENT))
    expect(server.sent[1].idempotencyKey).toBe(server.sent[0].idempotencyKey)
  })

  it("reads a bare 401 or 403 as a refusal, not a lost answer, and keeps the key", async () => {
    for (const status of [401, 403]) {
      const base = secretServer()
      const keys: (string | undefined)[] = []
      const client = {
        extension: base.client.extension,
        query: base.client.query,
        command: async (
          _intent: string,
          _payload?: unknown,
          opts?: { idempotencyKey?: string }
        ) => {
          keys.push(opts?.idempotencyKey)
          throw new ContractError(
            "TRANSPORT",
            `contract request failed with HTTP ${status}`
          )
        },
      } as ScopedClient
      mount(client)
      await screen.findByRole("checkbox", { name: "billing:read" })
      await submitNamed()
      expect((await screen.findByRole("alert")).textContent).toBe(
        `contract request failed with HTTP ${status}`
      )
      fireEvent.click(createButton())
      await waitFor(() => expect(keys).toHaveLength(2))
      expect(keys[1]).toBe(keys[0])
      cleanup()
      queryStore.clear()
    }
  })

  it("leaves the dialog open on a modifier-click of the key list link", async () => {
    const server = secretServer()
    mount(server.client)
    await screen.findByRole("checkbox", { name: "billing:read" })
    server.loseNextAnswer()
    await submitNamed()
    const link = within(await screen.findByRole("alert")).getByRole("link", {
      name: "key list",
    })
    // The stand-in Link is a bare anchor, and jsdom cannot navigate.
    const stop = (e: Event) => e.preventDefault()
    document.addEventListener("click", stop)
    try {
      fireEvent.click(link, { metaKey: true })
      fireEvent.click(link, { ctrlKey: true })
      fireEvent.click(link, { shiftKey: true })
      fireEvent.click(link, { button: 1 })
    } finally {
      document.removeEventListener("click", stop)
    }
    await act(async () => {})
    expect(screen.getByRole("dialog")).toBeTruthy()
  })
})

describe("CreateKeyDialog picks across a failed list read", () => {
  const FAILED = new ContractError(
    "TRANSPORT",
    "contract request failed with HTTP 502"
  )

  for (const list of ["scopes", "policies"] as const) {
    it(`keeps the picks and the key when the ${list} read fails after a lost answer`, async () => {
      const server = listServer()
      mount(server.client)
      fireEvent.click(await screen.findByRole("checkbox", { name: "billing:write" }))
      fireEvent.click(screen.getByRole("checkbox", { name: "reports:read" }))
      fill("Policy", "kpol_standard")
      server.loseNextAnswer()
      await submitNamed()
      expect((await screen.findByRole("alert")).textContent).toBe(LOST)

      if (list === "scopes") server.answerScopes(FAILED)
      else server.answerPolicies(FAILED)
      await act(async () => queryStore.revalidate())
      await waitFor(() => expect(createButton().disabled).toBe(false))

      // Nothing came off the form: a failed read says nothing about the picks.
      expect(screen.queryByText(/no longer listed/)).toBeNull()
      expect((screen.getByLabelText("Policy") as HTMLSelectElement).value).toBe(
        "kpol_standard"
      )
      expect(
        screen.getByRole("checkbox", { name: "billing:write" }).getAttribute("aria-checked")
      ).toBe("true")

      fireEvent.click(createButton())
      await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(SPENT))
      expect(server.sent).toHaveLength(2)
      expect(server.sent[1].payload).toEqual(server.sent[0].payload)
      expect(server.sent[1].idempotencyKey).toBe(server.sent[0].idempotencyKey)
      expect(server.ran["keys.create"]).toBe(1)
    })
  }

  it("says which list could not be reloaded, and that it shows the last answer", async () => {
    const server = listServer()
    mount(server.client)
    await screen.findByRole("checkbox", { name: "billing:write" })
    server.answerScopes(FAILED)
    server.answerPolicies(FAILED)
    await act(async () => queryStore.revalidate())
    expect(
      await screen.findByText(
        "Scopes could not be reloaded, so these are the ones from the last time they loaded."
      )
    ).toBeTruthy()
    expect(
      screen.getByText(
        "Policies could not be reloaded, so these are the ones from the last time they loaded."
      )
    ).toBeTruthy()
    expect(screen.getAllByRole("checkbox")).toHaveLength(3)
  })
})

describe("CreateKeyDialog picks across a context switch and a failed read", () => {
  const FAILED = new ContractError(
    "TRANSPORT",
    "contract request failed with HTTP 502"
  )

  it("keeps the payload and the key under a narrowing policy when the policies read fails", async () => {
    const server = listServer()
    mount(server.client)
    fireEvent.click(await screen.findByRole("checkbox", { name: "billing:read" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "billing:write" }))
    // Narrow allows billing:read only, so billing:write stays ticked but unsent.
    fill("Policy", "kpol_narrow")
    server.loseNextAnswer()
    await submitNamed()
    expect((await screen.findByRole("alert")).textContent).toBe(LOST)
    expect(server.sent[0].payload).toMatchObject({
      policyId: "kpol_narrow",
      scopes: ["billing:read"],
    })

    server.answerPolicies(FAILED)
    await act(async () => queryStore.revalidate())
    await waitFor(() => expect(createButton().disabled).toBe(false))
    expect(screen.getAllByRole("checkbox")).toHaveLength(1)

    fireEvent.click(createButton())
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(SPENT))
    expect(server.sent[1].payload).toEqual(server.sent[0].payload)
    expect(server.sent[1].idempotencyKey).toBe(server.sent[0].idempotencyKey)
    expect(server.ran["keys.create"]).toBe(1)
  })

  it("takes the old context's picks off when the new context's scopes read fails", async () => {
    const server = listServer()
    mount(server.client)
    fireEvent.click(await screen.findByRole("checkbox", { name: "billing:write" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "reports:read" }))
    fill("Name", "Billing service")

    server.answerScopes(FAILED)
    act(() => queryStore.clear())
    expect(
      await screen.findByText(
        "Some of your picks couldn't be checked after the switch and came off the form: billing:write and reports:read."
      )
    ).toBeTruthy()

    fireEvent.click(createButton())
    await screen.findByText("This is the only time Keysmith will show it.")
    expect(server.sent).toHaveLength(1)
    expect(server.sent[0].payload).toMatchObject({ scopes: [] })
  })

  it("shows no list from the old context when the new context's reads fail", async () => {
    const server = listServer()
    mount(server.client)
    fireEvent.click(await screen.findByRole("checkbox", { name: "billing:write" }))
    fill("Policy", "kpol_standard")

    server.answerScopes(FAILED)
    server.answerPolicies(FAILED)
    act(() => queryStore.clear())
    expect(
      await screen.findByText(
        "Scopes could not be loaded. You can still create the key and add scopes later."
      )
    ).toBeTruthy()
    expect(
      screen.getByText("Policies could not be loaded, so none can be chosen right now.")
    ).toBeTruthy()
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
    expect(
      within(screen.getByLabelText("Policy"))
        .getAllByRole("option")
        .map((o) => o.textContent)
    ).toEqual(["No policy"])
    expect((screen.getByLabelText("Policy") as HTMLSelectElement).value).toBe("")
    expect(screen.queryByText(/from the last time they loaded/)).toBeNull()
    expect(
      screen.getByText(
        "Some of your picks couldn't be checked after the switch and came off the form: billing:write and the Standard policy."
      )
    ).toBeTruthy()
  })
})
