import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import type { PlaygroundResult } from "../src/components/playground-lanes"
import { WardenPlaygroundPage } from "../src/pages/playground"
import { recordingQueryClient, renderPage, stubClient } from "./harness"

const FOOTER =
  "Runs as a dry run: writes nothing to the check log, fires no hooks, and neither reads nor fills the result cache."
const NOT_JSON = "This is not valid JSON."
const NOT_OBJECT = "This must be a JSON object."

/** Dave's delete: RBAC allows, the lockout policy denies, and it emits "audit". */
const DENIED: PlaygroundResult = {
  decision: "deny_explicit",
  allowed: false,
  reason: 'denied by policy "contractor-lockout"',
  matchedBy: [
    { source: "abac", ruleId: "wpol_contractor-lockout", detail: 'policy "contractor-lockout" (deny)' },
  ],
  obligations: ["audit", "notify:security"],
  evalTimeNs: 902_000,
  lanes: [
    {
      model: "rbac",
      state: "allow",
      decision: "allow",
      matchedBy: [{ source: "rbac", ruleId: "role_01hv", detail: "role grants document:delete" }],
    },
    { model: "rebac", state: "skipped", matchedBy: [] },
    {
      model: "abac",
      state: "deny",
      decision: "deny_explicit",
      reason: 'denied by policy "contractor-lockout"',
      matchedBy: [
        { source: "abac", ruleId: "wpol_contractor-lockout", detail: 'policy "contractor-lockout" (deny)' },
      ],
    },
  ],
}

/** A failed model: no decision, no evaluation time worth showing. */
const FAILED: PlaygroundResult = {
  decision: "error",
  allowed: false,
  error: "warden rbac: store unavailable",
  matchedBy: [],
  obligations: [],
  evalTimeNs: 55_000,
  lanes: [
    { model: "rbac", state: "error", error: "store unavailable", matchedBy: [] },
    { model: "rebac", state: "notEvaluated", matchedBy: [] },
    { model: "abac", state: "notEvaluated", matchedBy: [] },
  ],
}

const NAMESPACES = { namespaces: ["", "eng/platform"] }

function answers(extra: Record<string, unknown> = {}) {
  return { "playground.explain": DENIED, "namespaces.list": NAMESPACES, ...extra }
}

function setup(extra: Record<string, unknown> = {}) {
  const { client, sent } = recordingQueryClient(answers(extra))
  const view = renderPage(WardenPlaygroundPage, client)
  const explains = () =>
    sent.filter((s) => s.intent === "playground.explain").map((s) => s.params as Record<string, unknown>)
  return { ...view, sent, explains }
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function fillRequired() {
  fill("Subject id", "dave")
  fill("Action", "delete")
  fill("Resource type", "document")
}

const run = () => screen.getByRole("button", { name: "Run" })

describe("WardenPlaygroundPage: validation", () => {
  it("keeps Run disabled until subject id, action and resource type are filled", () => {
    setup()
    expect((run() as HTMLButtonElement).disabled).toBe(true)
    fill("Subject id", "dave")
    expect((run() as HTMLButtonElement).disabled).toBe(true)
    fill("Action", "delete")
    expect((run() as HTMLButtonElement).disabled).toBe(true)
    fill("Resource type", "document")
    expect((run() as HTMLButtonElement).disabled).toBe(false)
  })

  it("does not count whitespace as filled", () => {
    setup()
    fill("Subject id", "   ")
    fill("Action", "delete")
    fill("Resource type", "document")
    expect((run() as HTMLButtonElement).disabled).toBe(true)
  })

  it("names invalid JSON under the field it is in, and sends nothing", () => {
    const t = setup()
    fillRequired()
    fill("Context", "{nope")
    fireEvent.click(run())
    expect(screen.getByText(NOT_JSON)).toBeTruthy()
    const field = screen.getByLabelText("Context")
    expect(field.getAttribute("aria-invalid")).toBe("true")
    const described = document.getElementById(field.getAttribute("aria-describedby") ?? "")
    expect(described?.textContent).toBe(NOT_JSON)
    expect(screen.getByLabelText("Subject attributes").getAttribute("aria-invalid")).not.toBe("true")
    expect(t.explains()).toHaveLength(0)
  })

  it("checks all three JSON fields, each with its own message", () => {
    const t = setup()
    fillRequired()
    fill("Subject attributes", "{")
    fill("Resource attributes", "[1, 2]")
    fill("Context", "{}")
    fireEvent.click(run())
    const describe_ = (label: string) =>
      document.getElementById(screen.getByLabelText(label).getAttribute("aria-describedby") ?? "")
        ?.textContent
    expect(describe_("Subject attributes")).toBe(NOT_JSON)
    expect(describe_("Resource attributes")).toBe(NOT_OBJECT)
    expect(screen.getByLabelText("Context").getAttribute("aria-invalid")).not.toBe("true")
    expect(t.explains()).toHaveLength(0)
  })

  it("refuses JSON that is not an object: an array, a string, a number, null", () => {
    for (const value of ["[1]", '"text"', "42", "null", "true"]) {
      const t = setup()
      fillRequired()
      fill("Subject attributes", value)
      fireEvent.click(run())
      expect(screen.getAllByText(NOT_OBJECT)).toHaveLength(1)
      expect(t.explains(), value).toHaveLength(0)
      t.unmount()
    }
  })

  it("clears a field's message when the field is edited", () => {
    setup()
    fillRequired()
    fill("Context", "{nope")
    fireEvent.click(run())
    expect(screen.getByText(NOT_JSON)).toBeTruthy()
    fill("Context", '{"ip": "10.0.0.1"}')
    expect(screen.queryByText(NOT_JSON)).toBeNull()
  })

  it("opens the attributes and context disclosure when a JSON field is invalid", () => {
    setup()
    fillRequired()
    const details = screen.getByText("attributes and context").closest("details") as HTMLDetailsElement
    expect(details.open).toBe(false)
    fill("Context", "{nope")
    fireEvent.click(run())
    expect(details.open).toBe(true)
  })
})

describe("WardenPlaygroundPage: the request", () => {
  it("sends exactly the contract's keys when every field is filled", async () => {
    const t = setup()
    fireEvent.change(screen.getByLabelText("Subject kind"), { target: { value: "service" } })
    fill("Subject id", "deployer")
    fill("Action", "admin")
    fill("Resource type", "cluster")
    fill("Resource id", "prod")
    fill("Namespace", "eng/platform")
    fill("Subject attributes", '{"employment": "contractor"}')
    fill("Resource attributes", '{"tier": 2}')
    fill("Context", '{"network": "guest"}')
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
    expect(t.explains()).toHaveLength(1)
    const sent = t.explains()[0]
    expect(Object.keys(sent).sort()).toEqual(
      [
        "action",
        "context",
        "namespacePath",
        "resourceAttributes",
        "resourceId",
        "resourceType",
        "subjectAttributes",
        "subjectId",
        "subjectKind",
      ].sort(),
    )
    expect(sent).toEqual({
      subjectKind: "service",
      subjectId: "deployer",
      action: "admin",
      resourceType: "cluster",
      resourceId: "prod",
      namespacePath: "eng/platform",
      subjectAttributes: { employment: "contractor" },
      resourceAttributes: { tier: 2 },
      context: { network: "guest" },
    })
  })

  it("sends no key for a blank optional field, and always sends namespacePath", async () => {
    const t = setup()
    fillRequired()
    fill("Resource id", "   ")
    fill("Context", "  ")
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
    const sent = t.explains()[0]
    expect(Object.keys(sent).sort()).toEqual(
      ["action", "namespacePath", "resourceType", "subjectId", "subjectKind"].sort(),
    )
    expect(sent.namespacePath).toBe("")
    expect(sent.subjectKind).toBe("user")
  })

  it("trims the text fields", async () => {
    const t = setup()
    fill("Subject id", "  dave ")
    fill("Action", " delete")
    fill("Resource type", "document  ")
    fill("Namespace", " eng/platform ")
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
    expect(t.explains()[0]).toMatchObject({
      subjectId: "dave",
      action: "delete",
      resourceType: "document",
      namespacePath: "eng/platform",
    })
  })

  it("offers exactly the four subject kinds the check log uses", () => {
    setup()
    const options = within(screen.getByLabelText("Subject kind")).getAllByRole("option")
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      "user",
      "api_key",
      "service",
      "service_acct",
    ])
  })
})

describe("WardenPlaygroundPage: the result", () => {
  it("shows the decision, the reason and the evaluation time", async () => {
    setup()
    fillRequired()
    fireEvent.click(run())
    const badge = await screen.findByText("deny_explicit")
    expect(badge.getAttribute("data-variant")).toBe("secondary")
    expect(screen.getAllByText('denied by policy "contractor-lockout"').length).toBeGreaterThan(0)
    expect(screen.getByText("evaluated in 0.90 ms")).toBeTruthy()
  })

  it("shows three lanes in order, marks the deciding one, then the sentence", async () => {
    setup()
    fillRequired()
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
    const rows = within(screen.getByRole("list", { name: "Models" })).getAllByRole("listitem")
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText("RBAC")).toBeTruthy()
    expect(within(rows[1]).getByText("ReBAC")).toBeTruthy()
    expect(within(rows[2]).getByText("ABAC")).toBeTruthy()
    expect(within(rows[0]).queryByText("decided it")).toBeNull()
    expect(within(rows[1]).queryByText("decided it")).toBeNull()
    expect(within(rows[2]).getByText("decided it")).toBeTruthy()
    expect(screen.getAllByText("decided it")).toHaveLength(1)

    const sentence = screen.getByText("An explicit deny overrides the RBAC allow.")
    // The sentence follows the lanes.
    expect(
      screen.getByRole("list", { name: "Models" }).compareDocumentPosition(sentence) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it("lists the obligations the check would emit, in mono", async () => {
    setup()
    fillRequired()
    fireEvent.click(run())
    await screen.findByText("would emit")
    for (const o of ["audit", "notify:security"]) {
      expect(screen.getByText(o).className).toContain("font-mono")
    }
  })

  it("shows no obligations line when there are none", async () => {
    setup({ "playground.explain": { ...DENIED, obligations: [] } })
    fillRequired()
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
    expect(screen.queryByText("would emit")).toBeNull()
  })

  it("gives an allow the outline variant", async () => {
    setup({
      "playground.explain": {
        ...DENIED,
        decision: "allow",
        allowed: true,
        reason: undefined,
        obligations: [],
        lanes: [DENIED.lanes[0], DENIED.lanes[1], { model: "abac", state: "noMatch", matchedBy: [] }],
      },
    })
    fillRequired()
    fireEvent.click(run())
    const badge = await screen.findByText("allow", { selector: "[data-slot=badge]" })
    expect(badge.getAttribute("data-variant")).toBe("outline")
    expect(screen.getByText("RBAC allowed this check, and no deny policy matched.")).toBeTruthy()
  })

  it("shows a failed check's error, no evaluation time and the failed model", async () => {
    setup({ "playground.explain": FAILED })
    fillRequired()
    fireEvent.click(run())
    const badge = await screen.findByText("error", { selector: "[data-slot=badge]" })
    expect(badge.getAttribute("data-variant")).toBe("destructive")
    expect(screen.getByText("warden rbac: store unavailable").className).toContain("text-destructive")
    expect(screen.queryByText(/evaluated in/)).toBeNull()
    expect(screen.getByText("The RBAC model failed, so no decision was returned.")).toBeTruthy()
    expect(screen.queryByText("decided it")).toBeNull()
  })

  it("says nothing about a result before anything has run", () => {
    setup()
    expect(screen.queryByText(/evaluated in/)).toBeNull()
    expect(screen.queryByRole("list", { name: "Models" })).toBeNull()
  })

  it("shows a busy state while the check is running", async () => {
    const client = {
      extension: "warden",
      query: (intent: string) =>
        intent === "namespaces.list" ? Promise.resolve(NAMESPACES) : new Promise<never>(() => {}),
      command: async () => undefined,
    } as unknown as ScopedClient
    renderPage(WardenPlaygroundPage, client)
    fillRequired()
    fireEvent.click(run())
    await screen.findByRole("status")
    expect(screen.queryByRole("list", { name: "Models" })).toBeNull()
  })
})

describe("WardenPlaygroundPage: a refusal", () => {
  /** The first check succeeds, and every later one is refused. */
  function refusingAfterOne() {
    let calls = 0
    const base = stubClient(answers())
    const client = {
      extension: "warden",
      query: async (intent: string, params?: unknown) => {
        if (intent === "playground.explain") {
          calls += 1
          if (calls > 1) {
            throw new ContractError("BAD_REQUEST", "namespacePath is not a valid namespace path")
          }
        }
        return (base as { query: (i: string, p?: unknown) => Promise<unknown> }).query(intent, params)
      },
      command: base.command,
    } as unknown as ScopedClient
    return client
  }

  it("renders inside the builder and clears the previous result", async () => {
    renderPage(WardenPlaygroundPage, refusingAfterOne())
    fillRequired()
    fireEvent.click(run())
    await screen.findByText("deny_explicit")

    // The same input again: the request is sent again, and refused.
    fireEvent.click(run())
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("namespacePath is not a valid namespace path")
    expect(alert.textContent).toContain("BAD_REQUEST")
    expect(screen.queryByText("deny_explicit")).toBeNull()
    expect(screen.queryByText("decided it")).toBeNull()
    expect(screen.queryByText(/evaluated in/)).toBeNull()
    // In the builder: the form's own subtree holds the alert.
    expect(screen.getByLabelText("Subject id").closest("form")?.contains(alert)).toBe(true)
  })

  it("clears the refusal when the next check runs", async () => {
    let calls = 0
    const base = stubClient(answers())
    const client = {
      extension: "warden",
      query: async (intent: string, params?: unknown) => {
        if (intent === "playground.explain") {
          calls += 1
          if (calls === 1) throw new ContractError("BAD_REQUEST", "resourceType is required")
        }
        return (base as { query: (i: string, p?: unknown) => Promise<unknown> }).query(intent, params)
      },
      command: base.command,
    } as unknown as ScopedClient
    renderPage(WardenPlaygroundPage, client)
    fillRequired()
    fireEvent.click(run())
    await screen.findByRole("alert")
    fill("Action", "export")
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

describe("WardenPlaygroundPage: the footer", () => {
  it("says the page runs as a dry run", () => {
    setup()
    expect(screen.getByText(FOOTER)).toBeTruthy()
  })
})

describe("WardenPlaygroundPage: namespace suggestions", () => {
  function options() {
    return Array.from(document.querySelectorAll("datalist option")).map(
      (o) => (o as HTMLOptionElement).value,
    )
  }

  it("suggests the namespaces the server lists, with the root shown as /", async () => {
    setup()
    await waitFor(() => expect(options()).toEqual(["/", "eng/platform"]))
    const input = screen.getByLabelText("Namespace")
    const list = document.getElementById(input.getAttribute("list") ?? "")
    expect(list?.tagName).toBe("DATALIST")
  })

  it("accepts a path that is not a suggestion", async () => {
    const t = setup()
    fillRequired()
    fill("Namespace", "sandbox/deep")
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
    expect(t.explains()[0].namespacePath).toBe("sandbox/deep")
  })

  it("sends the root, chosen as /, as an empty path", async () => {
    const t = setup()
    fillRequired()
    fill("Namespace", "/")
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
    expect(t.explains()[0].namespacePath).toBe("")
  })

  it("still works when the namespace list fails", async () => {
    // stubClient refuses every intent it was not given, namespaces.list included.
    const client = stubClient({ "playground.explain": DENIED })
    renderPage(WardenPlaygroundPage, client)
    fillRequired()
    fill("Namespace", "eng/platform")
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

describe("WardenPlaygroundPage: running again", () => {
  it("sends a second request when Run is pressed again with the same input", async () => {
    const t = setup()
    fillRequired()
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
    expect(t.explains()).toHaveLength(1)
    await waitFor(() => expect((run() as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(run())
    await waitFor(() => expect(t.explains()).toHaveLength(2))
    await screen.findByText("deny_explicit")
    expect(t.explains()[1]).toEqual(t.explains()[0])
  })

  it("sends a new request for changed input", async () => {
    const t = setup()
    fillRequired()
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
    fill("Action", "export")
    fireEvent.click(run())
    await waitFor(() => expect(t.explains()).toHaveLength(2))
    expect(t.explains()[1].action).toBe("export")
  })
})
