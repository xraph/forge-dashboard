import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
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
import { PolicyEditorDialog } from "../src/components/policy-editor-dialog"
import { policyPath } from "../src/format"
import type { PolicyDetail, ScopesList } from "../src/types"
import { failingClient, recordingCommandClient } from "./harness"

const SCOPES: ScopesList = {
  hasMore: false,
  scopes: [
    { id: "kscope_1", name: "billing:read" },
    { id: "kscope_2", name: "billing:write" },
    { id: "kscope_3", name: "reports:read" },
  ],
}

const STORED: PolicyDetail = {
  id: "kpol_standard",
  name: "Standard",
  description: "For services",
  maxKeyLifetimeSeconds: 86400,
  graceSeconds: 2 * 3600,
  allowedScopes: ["billing:read"],
  rateLimit: 100,
  rateLimitWindowSeconds: 60,
  burstLimit: 20,
  allowedIps: ["10.0.0.0/8", "192.168.1.4"],
  allowedOrigins: ["https://example.com"],
  allowedMethods: ["GET", "POST"],
  allowedPaths: ["/v1/billing"],
  rotationPeriodSeconds: 30 * 86400,
  dailyQuota: 1000,
  monthlyQuota: 20000,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
}

function bare(over: Partial<PolicyDetail> = {}): PolicyDetail {
  return {
    id: "kpol_bare",
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
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...over,
  }
}

const CREATED = bare({ id: "kpol_new", name: "Partner" })

afterEach(() => {
  cleanup()
  queryStore.clear()
})

interface HostProps {
  policy?: PolicyDetail
  /** Left out, the host knows there is no rate limiter. */
  rateLimiterConfigured?: boolean | undefined
}

function Host({
  policy,
  rateLimiterConfigured,
  onClosed,
}: {
  policy?: PolicyDetail
  rateLimiterConfigured: boolean | undefined
  onClosed?: () => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open editor
      </button>
      <PolicyEditorDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) onClosed?.()
        }}
        policy={policy}
        rateLimiterConfigured={rateLimiterConfigured}
      />
    </>
  )
}

function mount(client: ScopedClient, props: HostProps = {}) {
  const navigate = vi.fn()
  const closed = vi.fn()
  const view = render(
    <PluginProvider client={client}>
      <NavigationProvider
        value={{
          navigate,
          Link: ({ to, children }) => <a href={to}>{children}</a>,
        }}
      >
        <Host
          policy={props.policy}
          rateLimiterConfigured={
            "rateLimiterConfigured" in props ? props.rateLimiterConfigured : false
          }
          onClosed={closed}
        />
      </NavigationProvider>
    </PluginProvider>,
  )
  return { ...view, navigate, closed }
}

function standard(answers: Record<string, unknown> = {}) {
  return recordingCommandClient(
    { "scopes.list": SCOPES, ...answers },
    {
      "policies.create": { policy: CREATED },
      "policies.update": { policy: STORED },
    },
  )
}

function fill(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function value(label: string | RegExp): string {
  return (screen.getByLabelText(label) as HTMLInputElement).value
}

function submitButton(): HTMLButtonElement {
  return within(screen.getByRole("dialog")).getByRole("button", {
    name: /^(Create policy|Save changes)$/,
  }) as HTMLButtonElement
}

function checked(name: string): boolean {
  return (
    screen.getByRole("checkbox", { name }).getAttribute("aria-checked") ===
    "true"
  )
}

/** The fields a form with nothing filled in sends, beside the name. */
const EMPTY_FIELDS = {
  description: "",
  maxKeyLifetimeSeconds: 0,
  graceSeconds: 0,
  allowedScopes: [],
  rateLimit: 0,
  rateLimitWindowSeconds: 0,
  burstLimit: 0,
  allowedIps: [],
  allowedOrigins: [],
  allowedMethods: [],
  allowedPaths: [],
  rotationPeriodSeconds: 0,
  dailyQuota: 0,
  monthlyQuota: 0,
}

describe("PolicyEditorDialog groups", () => {
  it("groups the fields by what enforces them", async () => {
    mount(standard().client)
    const d = await screen.findByRole("dialog", { name: "Create policy" })
    for (const legend of [
      "Enforced by Keysmith",
      "Enforced only with a rate limiter",
      "Stored for your application",
    ]) {
      expect(within(d).getByText(legend)).toBeTruthy()
    }
    expect(
      within(d).getByText(
        "Keysmith checks these: the lifetime when a key is created, scopes when they are assigned, and the grace when a key is rotated.",
      ),
    ).toBeTruthy()
    const stored = within(d).getByText(
      (_, el) =>
        el?.tagName === "P" &&
        el.textContent ===
          "Keysmith does not check these. Your application can read them from ValidationResult.Policy.",
    )
    // The Go name is an identifier, so it reads in mono.
    expect(stored.querySelector(".font-mono")?.textContent).toBe(
      "ValidationResult.Policy",
    )
    // Creating has nothing existing to warn about.
    expect(within(d).queryByText(/Changes apply from now on/)).toBeNull()
  })

  it("says the rate limit is not enforced when there is no rate limiter", async () => {
    mount(standard().client, { rateLimiterConfigured: false })
    const d = await screen.findByRole("dialog")
    expect(
      within(d).getByText(
        "This deployment has no rate limiter. These are stored, but not enforced here.",
      ),
    ).toBeTruthy()
    expect(within(d).queryByText(/has a rate limiter/)).toBeNull()
  })

  it("says the rate limit is enforced when there is a rate limiter", async () => {
    mount(standard().client, { rateLimiterConfigured: true })
    const d = await screen.findByRole("dialog")
    expect(
      within(d).getByText(
        "This deployment has a rate limiter, so Keysmith enforces these.",
      ),
    ).toBeTruthy()
    expect(within(d).queryByText(/no rate limiter/)).toBeNull()
  })

  it("says plainly when it is not known whether there is a rate limiter", async () => {
    mount(standard().client, { rateLimiterConfigured: undefined })
    const d = await screen.findByRole("dialog")
    expect(
      within(d).getByText(
        "Whether this deployment enforces these is not known right now.",
      ),
    ).toBeTruthy()
    expect(within(d).queryByText(/has a rate limiter/)).toBeNull()
    expect(within(d).queryByText(/no rate limiter/)).toBeNull()
  })

  it("says on edit that changes apply from now on", async () => {
    mount(standard().client, { policy: STORED })
    const d = await screen.findByRole("dialog", { name: "Edit Standard" })
    expect(
      within(d).getByText(
        "Changes apply from now on. Existing keys keep their expiry and scopes.",
      ),
    ).toBeTruthy()
  })

  it("says what a blank field means", async () => {
    mount(standard().client)
    await screen.findByRole("dialog")
    expect(
      screen.getByLabelText("Max key lifetime").getAttribute("placeholder"),
    ).toBe("No maximum")
    expect(
      screen.getByLabelText("Grace on rotation").getAttribute("placeholder"),
    ).toBe("24 hours (default)")
    await screen.findByRole("checkbox", { name: "billing:read" })
    expect(screen.getByText("None ticked: any scope.")).toBeTruthy()
  })

  it("lists the scopes by name in mono, asking for 200", async () => {
    const base = standard()
    const queried: { intent: string; params?: unknown }[] = []
    const client = {
      ...base.client,
      query: (intent: string, params?: Record<string, unknown>) => {
        queried.push({ intent, params })
        return base.client.query(intent, params)
      },
    } as ScopedClient
    mount(client)
    const box = await screen.findByRole("checkbox", { name: "billing:write" })
    expect(box.closest("label")?.querySelector(".font-mono")?.textContent).toBe(
      "billing:write",
    )
    expect(queried).toEqual([{ intent: "scopes.list", params: { limit: 200 } }])
  })
})

describe("PolicyEditorDialog create", () => {
  it("sends every field, converting durations to seconds", async () => {
    const { client, sent } = standard()
    const { navigate, closed } = mount(client)
    await screen.findByRole("checkbox", { name: "billing:write" })

    fill("Name", "  Partner  ")
    fill("Description", "Third parties")
    fill("Max key lifetime", "90")
    fill("Max key lifetime unit", "days")
    fill("Grace on rotation", "36")
    fill("Grace on rotation unit", "hours")
    fireEvent.click(screen.getByRole("checkbox", { name: "billing:write" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "reports:read" }))
    fill("Rate limit", "100")
    fill("Window", "1")
    fill("Window unit", "minutes")
    fill("Burst limit", "20")
    fill("Allowed IPs", "10.0.0.0/8\n\n  192.168.1.4  \n")
    fill("Allowed origins", "https://example.com")
    fill("Allowed paths", "/v1/billing\n/v1/reports")
    fireEvent.click(screen.getByRole("checkbox", { name: "GET" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "POST" }))
    fill("Rotation period", "30")
    fill("Daily quota", "1000")
    fill("Monthly quota", "20000")
    fireEvent.click(submitButton())

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].intent).toBe("policies.create")
    expect(sent[0].payload).toEqual({
      name: "Partner",
      description: "Third parties",
      maxKeyLifetimeSeconds: 7776000,
      graceSeconds: 129600,
      allowedScopes: ["billing:write", "reports:read"],
      rateLimit: 100,
      rateLimitWindowSeconds: 60,
      burstLimit: 20,
      allowedIps: ["10.0.0.0/8", "192.168.1.4"],
      allowedOrigins: ["https://example.com"],
      allowedMethods: ["GET", "POST"],
      allowedPaths: ["/v1/billing", "/v1/reports"],
      rotationPeriodSeconds: 2592000,
      dailyQuota: 1000,
      monthlyQuota: 20000,
    })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(policyPath("kpol_new")))
    expect(closed).toHaveBeenCalled()
  })

  it("sends 0 and [] for everything left blank", async () => {
    const { client, sent } = standard()
    mount(client)
    await screen.findByRole("dialog")
    fill("Name", "Partner")
    fireEvent.click(submitButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toEqual({ name: "Partner", ...EMPTY_FIELDS })
  })

  it("refuses a blank name before asking the server", async () => {
    const { client, sent } = standard()
    mount(client)
    await screen.findByRole("dialog")
    fill("Name", "   ")
    fireEvent.click(submitButton())
    const alert = within(screen.getByRole("dialog")).getByRole("alert")
    expect(alert.textContent).toBe("name is required")
    const name = screen.getByLabelText("Name")
    expect(name.getAttribute("aria-invalid")).toBe("true")
    expect(name.getAttribute("aria-describedby")).toBe(alert.id)
    expect(sent).toHaveLength(0)
  })

  it("refuses a duration or count that is not a whole number, naming the field", async () => {
    const { client, sent } = standard()
    mount(client)
    await screen.findByRole("dialog")
    fill("Name", "Partner")

    const cases: [string, string, string][] = [
      ["Max key lifetime", "1.5", "Max key lifetime must be a whole number."],
      ["Grace on rotation", "-1", "Grace on rotation must be a whole number."],
      ["Rate limit", "ten", "Rate limit must be a whole number."],
      ["Window", "1e3", "Window must be a whole number."],
      ["Burst limit", "2.0", "Burst limit must be a whole number."],
      ["Rotation period", "x", "Rotation period must be a whole number."],
      ["Daily quota", "-5", "Daily quota must be a whole number."],
      ["Monthly quota", "1,000", "Monthly quota must be a whole number."],
    ]
    for (const [label, bad, message] of cases) {
      fill(label, bad)
      fireEvent.click(submitButton())
      expect(screen.getByRole("alert").textContent).toBe(message)
      expect(screen.getByLabelText(label).getAttribute("aria-invalid")).toBe(
        "true",
      )
      fill(label, "")
    }
    expect(sent).toHaveLength(0)
  })

  it("treats a field of spaces as blank", async () => {
    const { client, sent } = standard()
    mount(client)
    await screen.findByRole("dialog")
    fill("Name", "Partner")
    fill("Max key lifetime", "   ")
    fireEvent.click(submitButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toMatchObject({ maxKeyLifetimeSeconds: 0 })
  })

  it("refuses a rate limit with no window", async () => {
    const { client, sent } = standard()
    mount(client)
    await screen.findByRole("dialog")
    fill("Name", "Partner")
    fill("Rate limit", "100")
    fireEvent.click(submitButton())
    expect(screen.getByRole("alert").textContent).toBe(
      "A rate limit needs a window.",
    )
    expect(screen.getByLabelText("Window").getAttribute("aria-invalid")).toBe(
      "true",
    )
    // The refused field takes the focus, so it is in view beside the message.
    expect(document.activeElement).toBe(screen.getByLabelText("Window"))
    fill("Window", "0")
    fireEvent.click(submitButton())
    expect(screen.getByRole("alert").textContent).toBe(
      "A rate limit needs a window.",
    )
    expect(sent).toHaveLength(0)
  })

  it("shows the server's CONFLICT inside the dialog and keeps the form", async () => {
    const base = standard()
    const client = {
      ...base.client,
      command: async () => {
        throw new ContractError("CONFLICT", "a policy with this name already exists")
      },
    } as ScopedClient
    const { navigate } = mount(client)
    await screen.findByRole("dialog")
    fill("Name", "Standard")
    fireEvent.click(submitButton())

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe("a policy with this name already exists")
    expect(screen.getByRole("dialog").contains(alert)).toBe(true)
    expect(value("Name")).toBe("Standard")
    expect(submitButton().disabled).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it("shows a failure from a throwing client inside the dialog", async () => {
    mount(failingClient(new ContractError("INTERNAL", "an internal error occurred")))
    await screen.findByRole("dialog")
    // Scopes could not be read either, and the form says so.
    expect(
      await screen.findByText(/Scopes could not be loaded/),
    ).toBeTruthy()
    fill("Name", "Partner")
    fireEvent.click(submitButton())
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe("an internal error occurred")
    expect(screen.getByRole("dialog").contains(alert)).toBe(true)
  })

  it("shows no earlier failure when it is opened again", async () => {
    const base = standard()
    const client = {
      ...base.client,
      command: async () => {
        throw new ContractError("CONFLICT", "a policy with this name already exists")
      },
    } as ScopedClient
    mount(client)
    await screen.findByRole("dialog")
    fill("Name", "Standard")
    fireEvent.click(submitButton())
    await screen.findByRole("alert")

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Open editor" }))
    const d = await screen.findByRole("dialog", { name: "Create policy" })
    expect(within(d).queryByRole("alert")).toBeNull()
    expect(screen.queryByText("a policy with this name already exists")).toBeNull()
    expect(value("Name")).toBe("")
  })

  it("sends one command however often the form is submitted while pending", async () => {
    const base = standard()
    let release: (value: unknown) => void = () => {}
    const client = {
      ...base.client,
      command: (intent: string, payload?: unknown) => {
        base.sent.push({ intent, payload })
        return new Promise<unknown>((resolve) => {
          release = resolve
        })
      },
    } as ScopedClient
    const { navigate } = mount(client)
    await screen.findByRole("dialog")
    fill("Name", "Partner")
    const form = submitButton().closest("form") as HTMLFormElement
    fireEvent.submit(form)
    fireEvent.submit(form)
    fireEvent.click(submitButton())
    expect(base.sent).toHaveLength(1)
    await waitFor(() => expect(submitButton().disabled).toBe(true))

    // Escape does not close it while the command is out.
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(screen.getByRole("dialog")).toBeTruthy()

    release({ policy: CREATED })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(policyPath("kpol_new")))
    expect(base.sent).toHaveLength(1)
  })
})

/** The standard client, but every command throws the server's refusal. */
function refusing(code: string, message: string): ScopedClient {
  return {
    ...standard().client,
    command: async () => {
      throw new ContractError(code, message)
    },
  } as ScopedClient
}

async function submitRefused(code: string, message: string): Promise<HTMLElement> {
  mount(refusing(code, message))
  await screen.findByRole("dialog")
  fill("Name", "Partner")
  fireEvent.click(submitButton())
  return screen.findByRole("alert")
}

function invalidIn(dialog: HTMLElement): Element[] {
  return [...dialog.querySelectorAll("[aria-invalid='true']")]
}

describe("PolicyEditorDialog server refusals", () => {
  it("names the field instead of its wire name, and marks and focuses it", async () => {
    const alert = await submitRefused(
      "BAD_REQUEST",
      "maxKeyLifetimeSeconds is at most 10 years",
    )
    expect(alert.textContent).toBe("Max key lifetime is at most 10 years")
    const field = screen.getByLabelText("Max key lifetime")
    expect(field.getAttribute("aria-invalid")).toBe("true")
    expect(field.getAttribute("aria-describedby")).toBe(alert.id)
    expect(invalidIn(screen.getByRole("dialog"))).toEqual([field])
    await waitFor(() => expect(document.activeElement).toBe(field))
  })

  it("names a list field in an entry refusal, and marks and focuses its textarea", async () => {
    const alert = await submitRefused(
      "BAD_REQUEST",
      'allowedOrigins: "x" is not an origin like https://example.com',
    )
    expect(alert.textContent).toBe(
      'Allowed origins: "x" is not an origin like https://example.com',
    )
    const field = screen.getByLabelText("Allowed origins")
    expect(field.tagName).toBe("TEXTAREA")
    expect(field.getAttribute("aria-invalid")).toBe("true")
    expect(field.getAttribute("aria-describedby")).toBe(alert.id)
    expect(invalidIn(screen.getByRole("dialog"))).toEqual([field])
    await waitFor(() => expect(document.activeElement).toBe(field))
  })

  it("matches the whole wire name, so the window is not read as the rate limit", async () => {
    const alert = await submitRefused(
      "BAD_REQUEST",
      "rateLimitWindowSeconds is at most 31 days",
    )
    expect(alert.textContent).toBe("Window is at most 31 days")
    const field = screen.getByLabelText("Window")
    expect(invalidIn(screen.getByRole("dialog"))).toEqual([field])
  })

  it("marks the allowed scopes group for a scope the tenant does not have, keeping the message", async () => {
    const message = 'scope "billing:admin" does not exist in this tenant'
    const alert = await submitRefused("BAD_REQUEST", message)
    expect(alert.textContent).toBe(message)
    const group = screen.getByRole("group", { name: "Allowed scopes" })
    expect(group.getAttribute("aria-invalid")).toBe("true")
    expect(group.getAttribute("aria-describedby")).toBe(alert.id)
    expect(invalidIn(screen.getByRole("dialog"))).toEqual([group])
  })

  it("marks the allowed methods group for a method refusal", async () => {
    const alert = await submitRefused(
      "BAD_REQUEST",
      'allowedMethods: "FETCH" is not an HTTP method',
    )
    expect(alert.textContent).toBe('Allowed methods: "FETCH" is not an HTTP method')
    const group = screen.getByRole("group", { name: "Allowed methods" })
    expect(group.getAttribute("aria-describedby")).toBe(alert.id)
    expect(invalidIn(screen.getByRole("dialog"))).toEqual([group])
  })

  it.each([
    ["CONFLICT", "a policy with this name already exists"],
    ["BAD_REQUEST", "a rate limit needs a window"],
    ["BAD_REQUEST", "rateLimiter is not a field"],
  ])("shows any other message as it came, marking nothing (%s %s)", async (code, message) => {
    const alert = await submitRefused(code, message)
    expect(alert.textContent).toBe(message)
    expect(invalidIn(screen.getByRole("dialog"))).toEqual([])
  })
})

describe("PolicyEditorDialog edit", () => {
  it("prefills every field from the policy", async () => {
    mount(standard().client, { policy: STORED })
    await screen.findByRole("checkbox", { name: "billing:read" })
    expect(value("Name")).toBe("Standard")
    expect(value("Description")).toBe("For services")
    // 86400 seconds reads as 1 day, not 24 hours or 86400 seconds.
    expect(value("Max key lifetime")).toBe("1")
    expect(value("Max key lifetime unit")).toBe("days")
    expect(value("Grace on rotation")).toBe("2")
    expect(value("Grace on rotation unit")).toBe("hours")
    expect(checked("billing:read")).toBe(true)
    expect(checked("billing:write")).toBe(false)
    expect(value("Rate limit")).toBe("100")
    expect(value("Window")).toBe("1")
    expect(value("Window unit")).toBe("minutes")
    expect(value("Burst limit")).toBe("20")
    expect(value("Allowed IPs")).toBe("10.0.0.0/8\n192.168.1.4")
    expect(value("Allowed origins")).toBe("https://example.com")
    expect(value("Allowed paths")).toBe("/v1/billing")
    expect(checked("GET")).toBe(true)
    expect(checked("POST")).toBe(true)
    expect(checked("DELETE")).toBe(false)
    expect(value("Rotation period")).toBe("30")
    expect(value("Daily quota")).toBe("1000")
    expect(value("Monthly quota")).toBe("20000")
  })

  it("sends the id and every field, then closes", async () => {
    const { client, sent } = standard()
    const { navigate, closed } = mount(client, { policy: STORED })
    await screen.findByRole("checkbox", { name: "billing:read" })
    fireEvent.click(submitButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].intent).toBe("policies.update")
    expect(sent[0].payload).toEqual({
      id: "kpol_standard",
      name: "Standard",
      description: "For services",
      maxKeyLifetimeSeconds: 86400,
      graceSeconds: 7200,
      allowedScopes: ["billing:read"],
      rateLimit: 100,
      rateLimitWindowSeconds: 60,
      burstLimit: 20,
      allowedIps: ["10.0.0.0/8", "192.168.1.4"],
      allowedOrigins: ["https://example.com"],
      allowedMethods: ["GET", "POST"],
      allowedPaths: ["/v1/billing"],
      rotationPeriodSeconds: 2592000,
      dailyQuota: 1000,
      monthlyQuota: 20000,
    })
    await waitFor(() => expect(closed).toHaveBeenCalled())
    expect(navigate).not.toHaveBeenCalled()
  })

  it("clears a field with 0 or [], never null", async () => {
    const { client, sent } = standard()
    mount(client, { policy: STORED })
    await screen.findByRole("checkbox", { name: "billing:read" })
    for (const label of [
      "Description",
      "Max key lifetime",
      "Grace on rotation",
      "Rate limit",
      "Window",
      "Burst limit",
      "Allowed IPs",
      "Allowed origins",
      "Allowed paths",
      "Rotation period",
      "Daily quota",
      "Monthly quota",
    ]) {
      fill(label, "")
    }
    fireEvent.click(screen.getByRole("checkbox", { name: "billing:read" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "GET" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "POST" }))
    expect(screen.getByText("None ticked: any scope.")).toBeTruthy()
    fireEvent.click(submitButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toEqual({
      id: "kpol_standard",
      name: "Standard",
      ...EMPTY_FIELDS,
    })
  })

  it("keeps an allowed scope that no longer exists, ticked and labelled", async () => {
    const { client, sent } = standard()
    mount(client, {
      policy: { ...STORED, allowedScopes: ["billing:read", "legacy:admin"] },
    })
    const gone = await screen.findByRole("checkbox", {
      name: "legacy:admin (no longer exists)",
    })
    expect(gone.getAttribute("aria-checked")).toBe("true")
    fireEvent.click(submitButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0].payload as { allowedScopes: string[] }).allowedScopes).toEqual(
      ["billing:read", "legacy:admin"],
    )
  })

  it("drops a scope that no longer exists only when it is unticked", async () => {
    const { client, sent } = standard()
    mount(client, {
      policy: { ...STORED, allowedScopes: ["legacy:admin"] },
    })
    const gone = await screen.findByRole("checkbox", {
      name: "legacy:admin (no longer exists)",
    })
    fireEvent.click(gone)
    // Still listed, so it can be ticked again.
    expect(
      screen.getByRole("checkbox", { name: "legacy:admin (no longer exists)" })
        .getAttribute("aria-checked"),
    ).toBe("false")
    fireEvent.click(submitButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0].payload as { allowedScopes: string[] }).allowedScopes).toEqual(
      [],
    )
  })

  it("keeps the allowed scopes when the scope list cannot be read", async () => {
    const base = standard()
    const client = {
      ...base.client,
      query: async () => {
        throw new ContractError("INTERNAL", "an internal error occurred")
      },
    } as ScopedClient
    mount(client, { policy: STORED })
    await screen.findByText(/Scopes could not be loaded/)
    expect(checked("billing:read")).toBe(true)
    fireEvent.click(submitButton())
    await waitFor(() => expect(base.sent).toHaveLength(1))
    expect(
      (base.sent[0].payload as { allowedScopes: string[] }).allowedScopes,
    ).toEqual(["billing:read"])
  })

  it("offers seconds for a stored value no other unit divides, so nothing rounds", async () => {
    const { client, sent } = standard()
    mount(client, {
      policy: bare({
        maxKeyLifetimeSeconds: 5400,
        graceSeconds: 90,
        rotationPeriodSeconds: 3600,
        rateLimit: 10,
        rateLimitWindowSeconds: 45,
      }),
    })
    await screen.findByRole("dialog")
    expect(value("Max key lifetime")).toBe("5400")
    expect(value("Max key lifetime unit")).toBe("seconds")
    expect(value("Grace on rotation")).toBe("90")
    expect(value("Grace on rotation unit")).toBe("seconds")
    expect(value("Rotation period")).toBe("3600")
    expect(value("Rotation period unit")).toBe("seconds")
    expect(value("Window")).toBe("45")
    expect(value("Window unit")).toBe("seconds")
    fireEvent.click(submitButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toMatchObject({
      maxKeyLifetimeSeconds: 5400,
      graceSeconds: 90,
      rotationPeriodSeconds: 3600,
      rateLimitWindowSeconds: 45,
    })
  })

  it("offers only the documented units when nothing needs seconds", async () => {
    mount(standard().client, { policy: STORED })
    await screen.findByRole("dialog")
    const options = (label: string) =>
      Array.from(
        (screen.getByLabelText(label) as HTMLSelectElement).options,
      ).map((o) => o.value)
    expect(options("Max key lifetime unit")).toEqual(["hours", "days"])
    expect(options("Grace on rotation unit")).toEqual(["hours", "days"])
    expect(options("Window unit")).toEqual(["seconds", "minutes", "hours"])
    expect(options("Rotation period unit")).toEqual(["days"])
  })

  it("shows the server's CONFLICT on a rename into a taken name", async () => {
    const base = standard()
    const client = {
      ...base.client,
      command: async () => {
        throw new ContractError("CONFLICT", "a policy with this name already exists")
      },
    } as ScopedClient
    const { closed } = mount(client, { policy: STORED })
    await screen.findByRole("dialog")
    fill("Name", "Open")
    fireEvent.click(submitButton())
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe("a policy with this name already exists")
    expect(screen.getByRole("dialog").contains(alert)).toBe(true)
    expect(closed).not.toHaveBeenCalled()
  })
})

/**
 * scopes.list answers SCOPES first and then whatever `later` says, so a test
 * can tick a scope and then have the list refetch under the open form.
 */
function refetchingScopes(later: () => Promise<ScopesList>) {
  const base = standard()
  let reads = 0
  const client = {
    ...base.client,
    query: (intent: string, params?: Record<string, unknown>) => {
      if (intent !== "scopes.list") return base.client.query(intent, params)
      reads += 1
      return reads === 1 ? Promise.resolve(SCOPES) : later()
    },
  } as ScopedClient
  return { client, sent: base.sent }
}

describe("PolicyEditorDialog allowed scopes through a refetch", () => {
  it("keeps a ticked scope when scopes.list refetches and fails", async () => {
    const { client, sent } = refetchingScopes(() =>
      Promise.reject(new ContractError("INTERNAL", "an internal error occurred")),
    )
    mount(client)
    fireEvent.click(await screen.findByRole("checkbox", { name: "billing:write" }))
    fill("Name", "Partner")

    // The store drops a query's data when its refetch fails.
    act(() => queryStore.invalidate("keysmith", ["scopes.list"]))
    await screen.findByText(/Scopes could not be loaded/)
    expect(checked("billing:write")).toBe(true)

    fireEvent.click(submitButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0].payload as { allowedScopes: string[] }).allowedScopes).toEqual(
      ["billing:write"],
    )
  })

  it("keeps a ticked scope the refetched list no longer has, and labels it", async () => {
    const { client, sent } = refetchingScopes(() =>
      Promise.resolve({
        hasMore: false,
        scopes: SCOPES.scopes.filter((s) => s.name !== "billing:write"),
      }),
    )
    mount(client, { policy: STORED })
    fireEvent.click(await screen.findByRole("checkbox", { name: "billing:write" }))

    act(() => queryStore.invalidate("keysmith", ["scopes.list"]))
    const gone = await screen.findByRole("checkbox", {
      name: "billing:write (no longer exists)",
    })
    expect(gone.getAttribute("aria-checked")).toBe("true")

    fireEvent.click(submitButton())
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(
      [...(sent[0].payload as { allowedScopes: string[] }).allowedScopes].sort(),
    ).toEqual(["billing:read", "billing:write"])
  })
})
