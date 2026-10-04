import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { ScopesEditor, useScopeEditing } from "../src/components/scopes-editor"
import type { KeySummary, PoliciesList, PolicySummary, ScopesList } from "../src/types"
import { recordingCommandClient, stubClient } from "./harness"

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
  policyId: "kpol_standard",
  scopes: ["billing:read"],
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-09-25T10:00:00Z",
}

const SCOPES: ScopesList = {
  scopes: [
    { id: "scope_1", name: "billing:read" },
    { id: "scope_2", name: "billing:write" },
    { id: "scope_3", name: "users:read" },
    { id: "scope_4", name: "users:write" },
  ],
  hasMore: false,
}

function policy(allowedScopes: string[]): PolicySummary {
  return {
    id: "kpol_standard",
    name: "Standard",
    maxKeyLifetimeSeconds: null,
    graceSeconds: null,
    allowedScopes,
  }
}

function policies(...list: PolicySummary[]): PoliciesList {
  return { policies: list, hasMore: false, rateLimiterConfigured: false }
}

const READS = {
  "scopes.list": SCOPES,
  "policies.list": policies(policy([])),
}

/** The page holds the commands above its QueryBoundary; this does the same. */
function Editor({ summary }: { summary: KeySummary }) {
  const editing = useScopeEditing(summary.id)
  return <ScopesEditor summary={summary} editing={editing} />
}

function renderEditor(client: ScopedClient, summary: KeySummary = KEY) {
  return render(
    <PluginProvider client={client}>
      <Editor summary={summary} />
    </PluginProvider>,
  )
}

/** Reads answer; every command throws the given refusal. */
function refusingClient(answers: Record<string, unknown>, error: ContractError): ScopedClient {
  const inner = stubClient(answers)
  return {
    extension: inner.extension,
    query: inner.query,
    command: async () => {
      throw error
    },
  } as ScopedClient
}

function picker(): HTMLSelectElement {
  return screen.getByLabelText("Add scope") as HTMLSelectElement
}

async function options(): Promise<string[]> {
  await waitFor(() => expect(picker().disabled).toBe(false))
  return [...picker().options].filter((o) => o.value !== "").map((o) => o.value)
}

function addButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Add" }) as HTMLButtonElement
}

describe("ScopesEditor tags", () => {
  it("shows each scope in mono with its own remove button", async () => {
    renderEditor(stubClient(READS), { ...KEY, scopes: ["billing:read", "users:read"] })
    for (const name of ["billing:read", "users:read"]) {
      expect(screen.getByText(name).className).toContain("font-mono")
      expect(screen.getByRole("button", { name: `Remove ${name}` })).toBeTruthy()
    }
  })

  it("says there are no scopes", () => {
    renderEditor(stubClient(READS), { ...KEY, scopes: [] })
    expect(screen.getByLabelText("no scopes")).toBeTruthy()
  })

  it("removes one scope with no confirmation, sending only that name", async () => {
    const { client, sent } = recordingCommandClient(READS, {
      "keys.scopes.remove": { key: { ...KEY, scopes: ["users:read"] } },
    })
    renderEditor(client, { ...KEY, scopes: ["billing:read", "users:read"] })
    const remove = screen.getByRole("button", { name: "Remove billing:read" })
    fireEvent.click(remove)
    fireEvent.click(remove)
    expect(screen.queryByRole("alertdialog")).toBeNull()
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent).toEqual([
      { intent: "keys.scopes.remove", payload: { id: KEY.id, scopes: ["billing:read"] } },
    ])
  })

  it("holds every button while one change is out", async () => {
    const { client, sent } = recordingCommandClient(READS, {
      "keys.scopes.remove": { key: KEY },
    })
    renderEditor(client, { ...KEY, scopes: ["billing:read", "users:read"] })
    fireEvent.click(screen.getByRole("button", { name: "Remove billing:read" }))
    fireEvent.click(screen.getByRole("button", { name: "Remove users:read" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toEqual({ id: KEY.id, scopes: ["billing:read"] })
  })
})

describe("ScopesEditor add", () => {
  it("offers the tenant's scopes the key does not hold yet", async () => {
    renderEditor(stubClient(READS))
    expect(await options()).toEqual(["billing:write", "users:read", "users:write"])
  })

  it("narrows the choice to the policy's allowed scopes", async () => {
    renderEditor(
      stubClient({
        "scopes.list": SCOPES,
        "policies.list": policies(policy(["billing:read", "billing:write"])),
      }),
    )
    expect(await options()).toEqual(["billing:write"])
    expect(screen.getByText("Only the scopes this key's policy allows are listed.")).toBeTruthy()
  })

  it("does not narrow for a policy that allows any scope", async () => {
    renderEditor(stubClient(READS))
    expect(await options()).toHaveLength(3)
    expect(screen.queryByText(/policy allows are listed/)).toBeNull()
  })

  it("does not narrow for a key with no policy", async () => {
    renderEditor(
      stubClient({
        "scopes.list": SCOPES,
        "policies.list": policies(policy(["billing:read"])),
      }),
      { ...KEY, policyId: undefined },
    )
    expect(await options()).toHaveLength(3)
  })

  it("waits for a choice, then sends keys.scopes.assign once with that one name", async () => {
    const { client, sent } = recordingCommandClient(READS, {
      "keys.scopes.assign": { key: { ...KEY, scopes: ["billing:read", "users:read"] } },
    })
    renderEditor(client)
    await options()
    expect(addButton().disabled).toBe(true)
    fireEvent.change(picker(), { target: { value: "users:read" } })
    expect(addButton().disabled).toBe(false)
    fireEvent.click(addButton())
    fireEvent.click(addButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent).toEqual([
      { intent: "keys.scopes.assign", payload: { id: KEY.id, scopes: ["users:read"] } },
    ])
    await waitFor(() => expect(picker().value).toBe(""))
  })

  it("says so when the key already holds every scope it can", async () => {
    renderEditor(stubClient(READS), {
      ...KEY,
      scopes: SCOPES.scopes.map((s) => s.name),
    })
    expect(await screen.findByText("This key already holds every scope there is to add.")).toBeTruthy()
  })

  it("says the scopes could not be loaded, and still lets you remove one", async () => {
    const { client, sent } = recordingCommandClient(
      { "policies.list": policies(policy([])) },
      { "keys.scopes.remove": { key: { ...KEY, scopes: [] } } },
    )
    renderEditor(client)
    expect(
      await screen.findByText("Scopes could not be loaded, so none can be added right now."),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Remove billing:read" }))
    await waitFor(() => expect(sent).toHaveLength(1))
  })

  /** scopes.list answers; policies.list waits forever, or throws `policiesError`. */
  function policiesClient(policiesError?: ContractError): ScopedClient {
    const inner = stubClient({ "scopes.list": SCOPES })
    return {
      extension: inner.extension,
      query: (intent: string, params?: Record<string, unknown>) => {
        if (intent !== "policies.list") return inner.query(intent, params)
        if (policiesError) return Promise.reject(policiesError)
        return new Promise<never>(() => {})
      },
      command: inner.command,
    } as ScopedClient
  }

  it("holds Add while the key's policy is still loading", async () => {
    renderEditor(policiesClient())
    // Scopes are in, the policy is not: the list may still narrow.
    await waitFor(() => expect(picker().options.length).toBeGreaterThan(1))
    fireEvent.change(picker(), { target: { value: "users:read" } })
    expect(addButton().disabled).toBe(true)
    expect(picker().disabled).toBe(true)
    expect(screen.getByRole("option", { name: "Loading the key's policy…" })).toBeTruthy()
  })

  it("does not wait for policies on a key with no policy", async () => {
    renderEditor(policiesClient(), { ...KEY, policyId: undefined })
    expect(await options()).toHaveLength(3)
    fireEvent.change(picker(), { target: { value: "users:read" } })
    expect(addButton().disabled).toBe(false)
  })

  it("says the list is not narrowed when policies fail, and still lets you add", async () => {
    renderEditor(
      policiesClient(new ContractError("TRANSPORT", "contract request failed with HTTP 502")),
    )
    expect(
      await screen.findByText(
        "The key's policy could not be loaded, so this list is not narrowed to it. The server refuses a scope the policy does not allow.",
      ),
    ).toBeTruthy()
    expect(await options()).toHaveLength(3)
    fireEvent.change(picker(), { target: { value: "users:read" } })
    expect(addButton().disabled).toBe(false)
    expect(screen.queryByText(/policy allows are listed/)).toBeNull()
  })

  it("says only the first scopes are listed when there are more", async () => {
    renderEditor(stubClient({ ...READS, "scopes.list": { ...SCOPES, hasMore: true } }))
    expect(await screen.findByText("Only the first 200 scopes are listed.")).toBeTruthy()
  })
})

describe("ScopesEditor refusals", () => {
  it.each([
    ["BAD_REQUEST", "a scope is outside this policy's allowed scopes"],
    ["BAD_REQUEST", 'scope "users:read" does not exist in this tenant'],
    ["CONFLICT", "a revoked key's scopes cannot be changed"],
  ])("shows an assign refused with %s: %s", async (code, message) => {
    renderEditor(refusingClient(READS, new ContractError(code, message)))
    await options()
    fireEvent.change(picker(), { target: { value: "users:read" } })
    fireEvent.click(addButton())
    expect((await screen.findByRole("alert")).textContent).toBe(message)
    // The choice is kept, so a retry is one click.
    expect(picker().value).toBe("users:read")
  })

  it("shows a refused remove and keeps the tag", async () => {
    renderEditor(
      refusingClient(
        READS,
        new ContractError("CONFLICT", "a revoked key's scopes cannot be changed"),
      ),
    )
    fireEvent.click(screen.getByRole("button", { name: "Remove billing:read" }))
    expect((await screen.findByRole("alert")).textContent).toBe(
      "a revoked key's scopes cannot be changed",
    )
    expect(screen.getByText("billing:read")).toBeTruthy()
  })

  it("clears the last refusal when the next change starts", async () => {
    const answers = { ...READS }
    let fail = true
    const client = {
      extension: "keysmith",
      query: stubClient(answers).query,
      command: async () => {
        if (fail) throw new ContractError("TRANSPORT", "contract request failed with HTTP 502")
        return { key: KEY }
      },
    } as ScopedClient
    renderEditor(client)
    fireEvent.click(screen.getByRole("button", { name: "Remove billing:read" }))
    await screen.findByRole("alert")
    fail = false
    await options()
    fireEvent.change(picker(), { target: { value: "users:read" } })
    fireEvent.click(addButton())
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  })
})

describe("ScopesEditor on a revoked key", () => {
  const REVOKED: KeySummary = {
    ...KEY,
    state: "revoked",
    effectiveState: "revoked",
    scopes: ["billing:read"],
  }

  it("shows the scopes with no way to change them, and says why", () => {
    renderEditor(stubClient(READS), REVOKED)
    expect(screen.getByText("billing:read").className).toContain("font-mono")
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.queryByLabelText("Add scope")).toBeNull()
    expect(screen.getByText("A revoked key's scopes cannot be changed.")).toBeTruthy()
  })

  it("asks for no scopes or policies", () => {
    const asked: string[] = []
    const inner = stubClient(READS)
    renderEditor(
      {
        ...inner,
        extension: inner.extension,
        query: (intent: string, params?: Record<string, unknown>) => {
          asked.push(intent)
          return inner.query(intent, params)
        },
      } as ScopedClient,
      REVOKED,
    )
    expect(asked).toEqual([])
  })
})

describe("ScopesEditor on an expired key", () => {
  it("still edits: the server only refuses a revoked key", async () => {
    renderEditor(stubClient(READS), { ...KEY, effectiveState: "expired", expiryPending: true })
    expect(screen.getByRole("button", { name: "Remove billing:read" })).toBeTruthy()
    expect(await options()).toHaveLength(3)
    expect(within(document.body).queryByText(/revoked key's scopes/)).toBeNull()
  })
})
