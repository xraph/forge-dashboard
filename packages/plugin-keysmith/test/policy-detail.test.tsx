import { describe, expect, it, vi } from "vitest"
import {
  act,
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
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import { PolicyDetailPage } from "../src/pages/policy-detail"
import { keyPath } from "../src/format"
import type {
  KeysList,
  KeySummary,
  PolicyDetail,
  PolicyDetailResponse,
} from "../src/types"
import { failingClient, recordingQueryClient, stubClient } from "./harness"

const ID = "kpol_standard"

const STANDARD: PolicyDetail = {
  id: ID,
  name: "Standard",
  description: "For services",
  maxKeyLifetimeSeconds: 86400,
  graceSeconds: 2 * 3600,
  allowedScopes: ["billing:read", "billing:write"],
  rateLimit: 100,
  rateLimitWindowSeconds: 60,
  burstLimit: 20,
  allowedIps: ["10.0.0.0/8"],
  allowedOrigins: ["https://example.com"],
  allowedMethods: ["GET", "POST"],
  allowedPaths: ["/v1/billing"],
  rotationPeriodSeconds: 30 * 86400,
  dailyQuota: 1000,
  monthlyQuota: 20000,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-20T12:00:00Z",
}

const BARE: PolicyDetail = {
  id: ID,
  name: "Bare",
  maxKeyLifetimeSeconds: null,
  graceSeconds: null,
  allowedScopes: [],
  rateLimit: null,
  rateLimitWindowSeconds: null,
  burstLimit: null,
  allowedIps: [],
  allowedOrigins: [],
  allowedMethods: [],
  allowedPaths: [],
  rotationPeriodSeconds: null,
  dailyQuota: null,
  monthlyQuota: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
}

function response(over: Partial<PolicyDetailResponse> = {}): PolicyDetailResponse {
  return {
    policy: STANDARD,
    keysUsing: 0,
    keysBlockingDelete: 0,
    rateLimiterConfigured: false,
    ...over,
  }
}

function key(over: Partial<KeySummary> = {}): KeySummary {
  return {
    id: "akey_billing",
    name: "Billing service",
    prefix: "sk",
    hint: "a3f8",
    environment: "live",
    state: "active",
    effectiveState: "active",
    expiryPending: false,
    expiresSoon: false,
    policyId: ID,
    scopes: [],
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...over,
  }
}

const KEYS: KeysList = {
  total: 2,
  keys: [
    key(),
    key({
      id: "akey_old",
      name: "Old reporter",
      hint: "19d4",
      state: "revoked",
      effectiveState: "revoked",
      revokedAt: "2026-09-10T00:00:00Z",
    }),
  ],
}

const SCOPES = { scopes: [], hasMore: false }

/** The page as the host mounts it. `id` null gives it no id in its params. */
function tree(client: ScopedClient, id: string | null, navigate: () => void) {
  return (
    <PluginProvider client={client}>
      <NavigationProvider
        value={{
          navigate,
          Link: ({ to, children, ...rest }) => (
            <a href={to} {...rest}>
              {children}
            </a>
          ),
        }}
      >
        <PolicyDetailPage params={id === null ? {} : { id }} />
      </NavigationProvider>
    </PluginProvider>
  )
}

/** `id` null renders the page with no id in its params. */
function mount(client: ScopedClient, id: string | null = ID) {
  const navigate = vi.fn()
  const view = render(tree(client, id, navigate))
  return { ...view, navigate }
}

async function show(r: PolicyDetailResponse = response(), keys: KeysList = KEYS) {
  const result = mount(
    stubClient({
      "policies.detail": r,
      "keys.list": keys,
      "scopes.list": SCOPES,
    }),
  )
  await screen.findByRole("heading", { level: 1, name: r.policy.name })
  return result
}

function section(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { level: 2, name })
  const el = heading.closest("section")
  if (!el) throw new Error(`no section for ${name}`)
  return el
}

/** The <dd> beside a term in a section's description list. */
function valueOf(sectionName: string, term: string): HTMLElement {
  const dt = within(section(sectionName))
    .getAllByText(term)
    .find((el) => el.tagName === "DT")
  const dd = dt?.nextElementSibling
  if (!dd || dd.tagName !== "DD") throw new Error(`no value for ${term}`)
  return dd as HTMLElement
}

const KEYSMITH = "Enforced by Keysmith"
const LIMITER = "Enforced only with a rate limiter"
const STORED = "Stored for your application"

describe("PolicyDetailPage header", () => {
  it("shows the name and description, with Edit and Delete", async () => {
    await show()
    expect(screen.getByText("For services")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy()
  })

  it("sends policies.detail with the route id", async () => {
    const { client, sent } = recordingQueryClient({
      "policies.detail": response(),
      "keys.list": KEYS,
    })
    mount(client)
    await screen.findByRole("heading", { level: 1 })
    expect(sent.find((s) => s.intent === "policies.detail")?.params).toEqual({
      id: ID,
    })
  })

  it("says there is nothing to show without an id in the address", () => {
    mount(stubClient({}), null)
    expect(screen.getByRole("status").textContent).toBe(
      "No policy id in the address, so there is nothing to show.",
    )
  })
})

describe("PolicyDetailPage fields", () => {
  it("groups the fields under the editor's headings and lines", async () => {
    await show()
    expect(
      within(section(KEYSMITH)).getByText(
        "Keysmith checks these: the lifetime when a key is created, scopes when they are assigned, and the grace when a key is rotated.",
      ),
    ).toBeTruthy()
    const stored = within(section(STORED)).getByText(
      (_, el) =>
        el?.tagName === "P" &&
        el.textContent ===
          "Keysmith does not check these. Your application can read them from ValidationResult.Policy.",
    )
    expect(stored.querySelector(".font-mono")?.textContent).toBe(
      "ValidationResult.Policy",
    )
  })

  it("says the rate limit is not enforced when there is no rate limiter", async () => {
    await show(response({ rateLimiterConfigured: false }))
    expect(
      within(section(LIMITER)).getByText(
        "This deployment has no rate limiter. These are stored, but not enforced here.",
      ),
    ).toBeTruthy()
    expect(within(section(LIMITER)).queryByText(/has a rate limiter/)).toBeNull()
  })

  it("says the rate limit is enforced when there is a rate limiter", async () => {
    await show(response({ rateLimiterConfigured: true }))
    expect(
      within(section(LIMITER)).getByText(
        "This deployment has a rate limiter, so Keysmith enforces these.",
      ),
    ).toBeTruthy()
    expect(within(section(LIMITER)).queryByText(/no rate limiter/)).toBeNull()
  })

  it("shows every value that is set", async () => {
    await show()
    expect(valueOf(KEYSMITH, "Max key lifetime").textContent).toBe("1 day")
    expect(valueOf(KEYSMITH, "Grace on rotation").textContent).toBe("2 hours")
    const scope = within(valueOf(KEYSMITH, "Allowed scopes")).getByText(
      "billing:write",
    )
    expect(scope.className).toMatch(/font-mono/)
    expect(valueOf(LIMITER, "Rate limit").textContent).toBe("100 per 1 minute")
    expect(valueOf(STORED, "Burst limit").textContent).toBe("20")
    expect(valueOf(STORED, "Rotation period").textContent).toBe("30 days")
    expect(valueOf(STORED, "Daily quota").textContent).toBe("1000")
    expect(valueOf(STORED, "Monthly quota").textContent).toBe("20000")
    for (const [term, v] of [
      ["Allowed IPs", "10.0.0.0/8"],
      ["Allowed origins", "https://example.com"],
      ["Allowed methods", "POST"],
      ["Allowed paths", "/v1/billing"],
    ]) {
      const tag = within(valueOf(STORED, term)).getByText(v)
      expect(tag.className).toMatch(/font-mono/)
      expect(tag.className).toMatch(/text-xs/)
    }
  })

  it("says what each unset value means", async () => {
    await show(response({ policy: BARE }))
    const none = (s: string, term: string, label: string) =>
      expect(within(valueOf(s, term)).getByLabelText(`no ${label}`)).toBeTruthy()
    none(KEYSMITH, "Max key lifetime", "maximum lifetime")
    none(LIMITER, "Rate limit", "rate limit")
    none(STORED, "Burst limit", "burst limit")
    none(STORED, "Rotation period", "rotation period")
    none(STORED, "Daily quota", "daily quota")
    none(STORED, "Monthly quota", "monthly quota")
    none(STORED, "Allowed IPs", "allowed IPs")
    none(STORED, "Allowed origins", "allowed origins")
    none(STORED, "Allowed methods", "allowed methods")
    none(STORED, "Allowed paths", "allowed paths")
    // No grace is not none: rotation uses 24 hours. And an empty allow list
    // is the widest policy there is.
    expect(valueOf(KEYSMITH, "Grace on rotation").textContent).toBe(
      "24 hours (default)",
    )
    expect(valueOf(KEYSMITH, "Allowed scopes").textContent).toBe("Any scope")
  })

  it("names a rate limit stored with no window", async () => {
    await show(
      response({
        policy: { ...BARE, rateLimit: 10, rateLimitWindowSeconds: null },
      }),
    )
    expect(valueOf(LIMITER, "Rate limit").textContent).toBe("10 with no window")
  })

  it("shows the id in mono and when the policy was created and updated", async () => {
    await show()
    expect(valueOf("Details", "ID").querySelector(".font-mono")?.textContent).toBe(ID)
    expect(valueOf("Details", "Created").textContent).toBe(
      formatTimestamp(STANDARD.createdAt),
    )
    expect(valueOf("Details", "Updated").textContent).toBe(
      formatTimestamp(STANDARD.updatedAt),
    )
  })
})

describe("PolicyDetailPage keys", () => {
  const KEYS_SECTION = "Keys using this policy"

  it.each([
    [5, 3, "5 keys use this policy. 2 of them are revoked."],
    [4, 3, "4 keys use this policy. 1 of them is revoked."],
    [3, 3, "3 keys use this policy."],
    [1, 1, "1 key uses this policy."],
    [1, 0, "1 key uses this policy. It is revoked."],
    [0, 0, "No keys use this policy."],
  ])(
    "counts %i keys with %i blocking",
    async (keysUsing, keysBlockingDelete, line) => {
      await show(response({ keysUsing, keysBlockingDelete }))
      expect(within(section(KEYS_SECTION)).getByText(line)).toBeTruthy()
    },
  )

  it("asks keys.list for this policy's keys, 25 at a time", async () => {
    const { client, sent } = recordingQueryClient({
      "policies.detail": response({ keysUsing: 2, keysBlockingDelete: 1 }),
      "keys.list": KEYS,
    })
    mount(client)
    await screen.findByRole("heading", { level: 1 })
    expect(sent.filter((s) => s.intent === "keys.list").map((s) => s.params)).toEqual([
      { policyId: ID, limit: 25, offset: 0 },
    ])
  })

  it("lists each key with a link, its masked key in mono and its state", async () => {
    await show(response({ keysUsing: 2, keysBlockingDelete: 1 }))
    const s = section(KEYS_SECTION)
    const link = await within(s).findByRole("link", { name: "Billing service" })
    expect(link.getAttribute("href")).toBe(keyPath("akey_billing"))
    const masked = within(s).getByText("sk_live_…19d4")
    expect(masked.className).toMatch(/font-mono/)
    expect(within(s).getByText("Revoked", { selector: "[data-slot=badge]" })).toBeTruthy()
    expect(within(s).getByText("Active", { selector: "[data-slot=badge]" })).toBeTruthy()
  })

  it("pages through the keys", async () => {
    const { client, sent } = recordingQueryClient({
      "policies.detail": response({ keysUsing: 30, keysBlockingDelete: 30 }),
      "keys.list": { ...KEYS, total: 30 },
    })
    mount(client)
    await screen.findByRole("heading", { level: 1 })
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }))
    await waitFor(() =>
      expect(
        sent.filter((s) => s.intent === "keys.list").map((s) => s.params),
      ).toEqual([
        { policyId: ID, limit: 25, offset: 0 },
        { policyId: ID, limit: 25, offset: 25 },
      ]),
    )
  })

  it("says so when no key uses the policy", async () => {
    await show(response(), { keys: [], total: 0 })
    expect(
      await within(section(KEYS_SECTION)).findByText("No keys to show."),
    ).toBeTruthy()
  })
})

describe("PolicyDetailPage delete", () => {
  const BLOCKED_LINE =
    "You can delete this policy once no active, suspended or expired key uses it."

  it("refuses to delete while a key that is not revoked uses it, and says why", async () => {
    await show(response({ keysUsing: 3, keysBlockingDelete: 2 }))
    const del = screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement
    expect(del.disabled).toBe(true)
    expect(screen.getByText(BLOCKED_LINE)).toBeTruthy()
  })

  it("offers Delete when only revoked keys use it", async () => {
    await show(response({ keysUsing: 3, keysBlockingDelete: 0 }))
    const del = screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement
    expect(del.disabled).toBe(false)
    expect(screen.queryByText(BLOCKED_LINE)).toBeNull()
  })

  it("asks first, sends policies.delete with the id, then goes to the policies list", async () => {
    const sent: { intent: string; payload: unknown }[] = []
    const inner = stubClient(
      { "policies.detail": response(), "keys.list": KEYS },
      { "policies.delete": { id: ID } },
    )
    const client = {
      ...inner,
      command: (intent: string, payload?: unknown) => {
        sent.push({ intent, payload })
        return inner.command(intent, payload)
      },
    } as ScopedClient
    const { navigate } = mount(client)
    await screen.findByRole("heading", { level: 1 })
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const d = await screen.findByRole("alertdialog", { name: "Delete Standard?" })
    expect(
      within(d).getByText(
        "Revoked keys that used it will show no policy. This cannot be undone.",
      ),
    ).toBeTruthy()
    fireEvent.click(within(d).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/policies"))
    expect(sent).toEqual([{ intent: "policies.delete", payload: { id: ID } }])
  })

  it("shows the server's CONFLICT inside the dialog and stays", async () => {
    const inner = stubClient({ "policies.detail": response(), "keys.list": KEYS })
    const client = {
      ...inner,
      command: async () => {
        throw new ContractError(
          "CONFLICT",
          "1 key that is not revoked uses this policy",
        )
      },
    } as ScopedClient
    const { navigate } = mount(client)
    await screen.findByRole("heading", { level: 1 })
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const d = await screen.findByRole("alertdialog", { name: "Delete Standard?" })
    fireEvent.click(within(d).getByRole("button", { name: "Delete" }))
    const alert = await within(d).findByRole("alert")
    expect(alert.textContent).toBe("1 key that is not revoked uses this policy")
    // In the dialog's body, not its description.
    expect(alert.closest("[data-slot=confirm-dialog-body]")).not.toBeNull()
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })

  it("shows a failure from a throwing client inside the dialog", async () => {
    const reads = stubClient({ "policies.detail": response(), "keys.list": KEYS })
    const client = {
      ...reads,
      command: failingClient(new ContractError("INTERNAL", "an internal error occurred"))
        .command,
    } as ScopedClient
    mount(client)
    await screen.findByRole("heading", { level: 1 })
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const d = await screen.findByRole("alertdialog")
    fireEvent.click(within(d).getByRole("button", { name: "Delete" }))
    expect((await within(d).findByRole("alert")).textContent).toBe(
      "an internal error occurred",
    )
  })
})

describe("PolicyDetailPage edit", () => {
  it("opens the editor with the policy and the page's rate limiter answer", async () => {
    await show(response({ rateLimiterConfigured: true }))
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    const d = await screen.findByRole("dialog", { name: "Edit Standard" })
    expect((within(d).getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Standard",
    )
    expect(
      within(d).getByText(
        "This deployment has a rate limiter, so Keysmith enforces these.",
      ),
    ).toBeTruthy()
    expect(
      within(d).getByText(
        "Changes apply from now on. Existing keys keep their expiry and scopes.",
      ),
    ).toBeTruthy()
  })
})

describe("PolicyDetailPage not found", () => {
  it.each([
    ["NOT_FOUND", "policy not found"],
    ["BAD_REQUEST", "id is not a policy id"],
  ])("says there is no such policy on %s %s", async (code, message) => {
    mount(failingClient(new ContractError(code, message)))
    expect(await screen.findByText("No policy with this id.")).toBeTruthy()
    const back = screen.getByRole("link", { name: "Back to policies" })
    expect(back.getAttribute("href")).toBe("/policies")
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
  })

  it("shows the error card for any other failure", async () => {
    mount(stubClient({ "keys.list": KEYS }))
    expect(await screen.findByText(/no handler for intent "policies.detail"/)).toBeTruthy()
    expect(screen.queryByText("No policy with this id.")).toBeNull()
  })
})

/**
 * A client that answers like the host, as in key-detail.test.tsx: a command's
 * `invalidates` reaches `queryStore.invalidate` before its answer comes back,
 * and a refusal invalidates nothing. Every policies.detail read after the
 * first waits until the test releases it, so the test can look at the page
 * while it refetches. An intent can be given a list of outcomes, one per call.
 */
type HostOutcome =
  | { answer: unknown; invalidates: string[]; next: PolicyDetailResponse }
  | { error: ContractError }

function hostLikeClient(
  first: PolicyDetailResponse,
  commands: Record<string, HostOutcome | HostOutcome[]>,
  options: {
    refetchError?: ContractError
    /** keys.list's answer for the params it was sent. KEYS by default. */
    keys?: (params: { offset: number }) => KeysList
  } = {},
) {
  let current = first
  let reads = 0
  const sent: { intent: string; payload: unknown }[] = []
  const queries: { intent: string; params: unknown }[] = []
  const held: (() => void)[] = []
  const client = {
    extension: "keysmith",
    query: (intent: string, params?: Record<string, unknown>) => {
      queries.push({ intent, params })
      if (intent === "keys.list") {
        return Promise.resolve(
          options.keys ? options.keys(params as { offset: number }) : KEYS,
        )
      }
      if (intent === "scopes.list") return Promise.resolve(SCOPES)
      if (intent !== "policies.detail") {
        return Promise.reject(
          new ContractError("NOT_FOUND", `no handler for intent "${intent}"`),
        )
      }
      reads += 1
      const answer = current
      if (reads === 1) return Promise.resolve(answer)
      const { refetchError } = options
      return new Promise((resolve, reject) =>
        held.push(() => (refetchError ? reject(refetchError) : resolve(answer))),
      )
    },
    command: async (intent: string, payload?: unknown) => {
      sent.push({ intent, payload })
      const plan = commands[intent]
      const c = Array.isArray(plan) ? plan.shift() : plan
      if (!c) throw new ContractError("NOT_FOUND", `no handler for command "${intent}"`)
      if ("error" in c) throw c.error
      current = c.next
      queryStore.invalidate("keysmith", c.invalidates)
      return c.answer
    },
  } as unknown as ScopedClient
  return {
    client,
    sent,
    /** The params of every keys.list read, in order. */
    keysParams: () =>
      queries.filter((q) => q.intent === "keys.list").map((q) => q.params),
    releaseReads: () => {
      for (const release of held.splice(0)) release()
    },
  }
}

function loading() {
  return screen.queryByRole("status", { name: "Loading Policy", hidden: true })
}

describe("PolicyDetailPage dialogs through a refetch", () => {
  const TAKEN = new ContractError("CONFLICT", "a policy with this name already exists")
  const UPDATE_INVALIDATES = ["policies.list", "policies.detail", "keys.detail"]

  // Nothing on this page refetches policies.detail under an open dialog by
  // itself, so the test invalidates it directly, as any other command in the
  // app that names policies.detail would (keys.create, keys.revoke).
  it("keeps the editor, what was typed and its error through a refetch, then saves", async () => {
    const RENAMED = { ...STANDARD, name: "Partner" }
    const host = hostLikeClient(response(), {
      "policies.update": [
        { error: TAKEN },
        {
          answer: { policy: RENAMED },
          invalidates: UPDATE_INVALIDATES,
          next: response({ policy: RENAMED }),
        },
      ],
    })
    mount(host.client)
    await screen.findByRole("heading", { level: 1, name: "Standard" })

    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    const d = await screen.findByRole("dialog", { name: "Edit Standard" })
    fireEvent.change(within(d).getByLabelText("Name"), { target: { value: "Partner" } })
    fireEvent.click(within(d).getByRole("button", { name: "Save changes" }))
    expect((await within(d).findByRole("alert")).textContent).toBe(TAKEN.message)

    act(() => queryStore.invalidate("keysmith", ["policies.detail"]))
    await waitFor(() => expect(loading()).not.toBeNull())
    const during = screen.getByRole("dialog", { name: "Edit Standard" })
    expect((within(during).getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Partner",
    )
    expect(within(during).getByRole("alert").textContent).toBe(TAKEN.message)

    host.releaseReads()
    await waitFor(() => expect(loading()).toBeNull())
    const after = screen.getByRole("dialog", { name: "Edit Standard" })
    expect((within(after).getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Partner",
    )

    // The retry lands: the dialog closes and the page refetches the policy.
    fireEvent.click(within(after).getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    host.releaseReads()
    expect(await screen.findByRole("heading", { level: 1, name: "Partner" })).toBeTruthy()
    expect(host.sent.map((s) => s.intent)).toEqual([
      "policies.update",
      "policies.update",
    ])
  })

  it("keeps the delete dialog, its name and its error through a refetch", async () => {
    const host = hostLikeClient(response(), {
      "policies.delete": {
        error: new ContractError("CONFLICT", "1 key that is not revoked uses this policy"),
      },
    })
    mount(host.client)
    await screen.findByRole("heading", { level: 1, name: "Standard" })
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await screen.findByRole("alertdialog", { name: "Delete Standard?" })

    act(() => queryStore.invalidate("keysmith", ["policies.detail"]))
    await waitFor(() => expect(loading()).not.toBeNull())
    const during = screen.getByRole("alertdialog", { name: "Delete Standard?" })
    fireEvent.click(within(during).getByRole("button", { name: "Delete" }))
    expect((await within(during).findByRole("alert")).textContent).toBe(
      "1 key that is not revoked uses this policy",
    )

    host.releaseReads()
    await waitFor(() => expect(loading()).toBeNull())
    const after = screen.getByRole("alertdialog", { name: "Delete Standard?" })
    expect(within(after).getByRole("alert").textContent).toBe(
      "1 key that is not revoked uses this policy",
    )
  })

  it("keeps the delete dialog's name as it was when Delete was pressed", async () => {
    const RENAMED = { ...STANDARD, name: "Partner" }
    const host = hostLikeClient(response(), {
      "policies.update": {
        answer: { policy: RENAMED },
        invalidates: UPDATE_INVALIDATES,
        next: response({ policy: RENAMED }),
      },
    })
    mount(host.client)
    await screen.findByRole("heading", { level: 1, name: "Standard" })
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await screen.findByRole("alertdialog", { name: "Delete Standard?" })

    // A rename lands elsewhere and the page refetches under the dialog.
    await act(async () => {
      await host.client.command("policies.update", { id: ID, name: "Partner" })
    })
    host.releaseReads()
    await waitFor(() => expect(loading()).toBeNull())
    expect(screen.getByRole("alertdialog", { name: "Delete Standard?" })).toBeTruthy()
  })

  it("keeps the editor and the last rate limiter answer when the refetch fails", async () => {
    const host = hostLikeClient(
      response({ rateLimiterConfigured: true }),
      {},
      { refetchError: new ContractError("TRANSPORT", "contract request failed with HTTP 502") },
    )
    mount(host.client)
    await screen.findByRole("heading", { level: 1, name: "Standard" })
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    await screen.findByRole("dialog", { name: "Edit Standard" })

    act(() => queryStore.invalidate("keysmith", ["policies.detail"]))
    await waitFor(() => expect(loading()).not.toBeNull())
    host.releaseReads()
    await waitFor(() => expect(loading()).toBeNull())
    // The page lost its data and shows its error card.
    expect(screen.queryByRole("heading", { level: 1, hidden: true })).toBeNull()
    const d = screen.getByRole("dialog", { name: "Edit Standard" })
    expect(
      within(d).getByText(
        "This deployment has a rate limiter, so Keysmith enforces these.",
      ),
    ).toBeTruthy()
    expect(within(d).queryByText(/not known/)).toBeNull()
  })
})

describe("PolicyDetailPage keys through a refetch", () => {
  const MANY = response({ keysUsing: 30, keysBlockingDelete: 30 })
  const LATE = key({ id: "akey_late", name: "Late reporter", hint: "77aa" })

  function last<T>(list: T[]): T | undefined {
    return list[list.length - 1]
  }

  it("stays on the page of keys it was on while the policy refetches", async () => {
    const host = hostLikeClient(MANY, {}, {
      keys: ({ offset }) =>
        offset === 0 ? { ...KEYS, total: 30 } : { keys: [LATE], total: 30 },
    })
    mount(host.client)
    await screen.findByRole("heading", { level: 1, name: "Standard" })
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }))
    expect(await screen.findByRole("link", { name: "Late reporter" })).toBeTruthy()

    // The policy refetches: the page is a skeleton, and comes back on page 2.
    act(() => queryStore.invalidate("keysmith", ["policies.detail"]))
    await waitFor(() => expect(loading()).not.toBeNull())
    act(() => host.releaseReads())
    await waitFor(() => expect(loading()).toBeNull())

    expect(await screen.findByRole("link", { name: "Late reporter" })).toBeTruthy()
    expect(screen.getByText("Page 2 of 2, 30 total")).toBeTruthy()
    expect(last(host.keysParams())).toEqual({ policyId: ID, limit: 25, offset: 25 })
  })

  it("keeps the keys and the pager, and the pager keeps focus, while the next page loads", async () => {
    const waiting: ((list: KeysList) => void)[] = []
    const client = {
      extension: "keysmith",
      query: (intent: string, params?: Record<string, unknown>) => {
        if (intent === "policies.detail") return Promise.resolve(MANY)
        if (intent === "scopes.list") return Promise.resolve(SCOPES)
        if (intent === "keys.list") {
          if (params?.offset === 0) return Promise.resolve({ ...KEYS, total: 30 })
          return new Promise<KeysList>((resolve) => waiting.push(resolve))
        }
        return Promise.reject(new ContractError("NOT_FOUND", `no handler for intent "${intent}"`))
      },
      command: async () => {
        throw new ContractError("NOT_FOUND", "no commands")
      },
    } as unknown as ScopedClient
    mount(client)
    await screen.findByRole("heading", { level: 1, name: "Standard" })
    const next = await screen.findByRole("button", { name: "Next page" })
    next.focus()
    fireEvent.click(next)

    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull())
    expect(screen.getByRole("link", { name: "Billing service" })).toBeTruthy()
    expect(screen.queryByRole("status", { name: "Loading Keys" })).toBeNull()
    expect(screen.getByRole("button", { name: "Next page" })).toBe(next)
    expect(document.activeElement).toBe(next)

    await act(async () => waiting.shift()!({ keys: [LATE], total: 30 }))
    expect(await screen.findByRole("link", { name: "Late reporter" })).toBeTruthy()
  })

  it("steps back a page when keys leave the page it was on", async () => {
    let total = 30
    const host = hostLikeClient(MANY, {}, {
      keys: ({ offset }) =>
        offset === 0
          ? { ...KEYS, total }
          : { keys: total > 25 ? [LATE] : [], total },
    })
    mount(host.client)
    await screen.findByRole("heading", { level: 1, name: "Standard" })
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }))
    expect(await screen.findByRole("link", { name: "Late reporter" })).toBeTruthy()

    // Ten keys are revoked elsewhere, and page 2 now has nothing on it.
    total = 20
    act(() => queryStore.invalidate("keysmith", ["policies.detail", "keys.list"]))
    act(() => host.releaseReads())

    expect(await screen.findByRole("link", { name: "Billing service" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Late reporter" })).toBeNull()
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull()
    expect(last(host.keysParams())).toEqual({ policyId: ID, limit: 25, offset: 0 })
  })
})

describe("PolicyDetailPage moving to another policy", () => {
  const PARTNER_ID = "kpol_partner"
  const PARTNER = response({ policy: { ...STANDARD, id: PARTNER_ID, name: "Partner" } })

  /** Answers the first policy at once and holds the second until released. */
  function twoPolicies(second: PolicyDetailResponse | ContractError) {
    const held: (() => void)[] = []
    const client = {
      extension: "keysmith",
      query: (intent: string, params?: Record<string, unknown>) => {
        if (intent === "keys.list") return Promise.resolve(KEYS)
        if (intent === "scopes.list") return Promise.resolve(SCOPES)
        if (intent !== "policies.detail") {
          return Promise.reject(
            new ContractError("NOT_FOUND", `no handler for intent "${intent}"`),
          )
        }
        if (params?.id === ID) return Promise.resolve(response())
        return new Promise((resolve, reject) =>
          held.push(() =>
            second instanceof ContractError ? reject(second) : resolve(second),
          ),
        )
      },
      command: async (intent: string) => {
        throw new ContractError("NOT_FOUND", `no handler for command "${intent}"`)
      },
    } as unknown as ScopedClient
    return {
      client,
      release: () => {
        for (const r of held.splice(0)) r()
      },
    }
  }

  it("starts the next policy with no dialog open and no earlier name", async () => {
    const two = twoPolicies(PARTNER)
    const { rerender, navigate } = mount(two.client)
    await screen.findByRole("heading", { level: 1, name: "Standard" })
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await screen.findByRole("alertdialog", { name: "Delete Standard?" })

    rerender(tree(two.client, PARTNER_ID, navigate))
    // While the next policy loads, nothing of the first is on screen.
    await waitFor(() => expect(loading()).not.toBeNull())
    expect(
      screen.queryByRole("heading", { level: 1, name: "Standard", hidden: true }),
    ).toBeNull()
    expect(screen.queryByRole("alertdialog", { hidden: true })).toBeNull()
    expect(screen.queryByText("Delete Standard?")).toBeNull()

    act(() => two.release())
    expect(await screen.findByRole("heading", { level: 1, name: "Partner" })).toBeTruthy()
    expect(screen.queryByRole("alertdialog", { hidden: true })).toBeNull()

    // Delete now asks about the policy on screen.
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    expect(await screen.findByRole("alertdialog", { name: "Delete Partner?" })).toBeTruthy()
  })

  it("does not bring back the first policy's editor when the next one fails to load", async () => {
    const two = twoPolicies(
      new ContractError("TRANSPORT", "contract request failed with HTTP 502"),
    )
    const { rerender, navigate } = mount(two.client)
    await screen.findByRole("heading", { level: 1, name: "Standard" })
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    await screen.findByRole("dialog", { name: "Edit Standard" })

    rerender(tree(two.client, PARTNER_ID, navigate))
    act(() => two.release())
    expect(await screen.findByText(/contract request failed with HTTP 502/)).toBeTruthy()
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull()
    expect(screen.queryByText("Edit Standard")).toBeNull()
  })
})
