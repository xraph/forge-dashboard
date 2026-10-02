import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
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

afterEach(() => {
  cleanup()
  queryStore.clear()
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

function standard(commandAnswer: unknown = WITH_SECRET) {
  return recordingCommandClient(
    { "policies.list": POLICIES, "scopes.list": SCOPES },
    { "keys.create": commandAnswer }
  )
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
    expect(options).toEqual(["No policy", "Standard", "Narrow"])

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
    fill(/^Expiry/, "2027-03-01")
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
      expiresAt: "2027-03-01T23:59:59Z",
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
