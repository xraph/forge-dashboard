import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import type { CheckDetail } from "../src/components/check-log"
import type { PlaygroundResult } from "../src/components/playground-lanes"
import { WardenPlaygroundPage } from "../src/pages/playground"
import { recordingQueryClient, renderPage, stubClient } from "./harness"

const FOOTER =
  "The check you build runs as a dry run: it writes nothing to the check log, fires no hooks, and neither reads nor fills the result cache. Your own permission to run it is checked, and warden logs that check like any other."
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
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value

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

  it("counts only an empty string as unfilled: a space is an id", () => {
    setup()
    fill("Subject id", " ")
    fill("Action", "delete")
    fill("Resource type", "document")
    expect((run() as HTMLButtonElement).disabled).toBe(false)
    fill("Subject id", "")
    expect((run() as HTMLButtonElement).disabled).toBe(true)
  })

  it("marks the three required inputs required, and no others", () => {
    setup()
    for (const label of ["Subject id", "Action", "Resource type"]) {
      expect(screen.getByLabelText(label).getAttribute("aria-required"), label).toBe("true")
    }
    for (const label of ["Resource id", "Namespace", "Context"]) {
      expect(screen.getByLabelText(label).getAttribute("aria-required"), label).toBeNull()
    }
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

  it("sends the text fields exactly as typed, with no trimming", async () => {
    const t = setup()
    fill("Subject id", "  dave ")
    fill("Action", " delete")
    fill("Resource type", "document  ")
    fill("Resource id", " readme ")
    fill("Namespace", " eng/platform ")
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
    expect(t.explains()[0]).toEqual({
      subjectKind: "user",
      subjectId: "  dave ",
      action: " delete",
      resourceType: "document  ",
      resourceId: " readme ",
      namespacePath: " eng/platform ",
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
    // The deciding lane, and only it, carries the left rule.
    expect(rows.map((r) => r.getAttribute("data-deciding"))).toEqual([null, null, "true"])
    expect(rows[2].className).toContain("border-l-foreground")

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

  it("says the lane that supplied a denial's reason gave the reason, not that it decided", async () => {
    const NO_ROLES: PlaygroundResult = {
      decision: "deny_no_roles",
      allowed: false,
      reason: "subject user:dave has no assigned roles",
      matchedBy: [],
      obligations: [],
      evalTimeNs: 100_000,
      lanes: [
        { model: "rbac", state: "noMatch", decision: "deny_no_roles", reason: "subject user:dave has no assigned roles", matchedBy: [] },
        { model: "rebac", state: "noMatch", decision: "deny_relation", reason: "no relation", matchedBy: [] },
        { model: "abac", state: "noMatch", matchedBy: [] },
      ],
    }
    setup({ "playground.explain": NO_ROLES })
    fillRequired()
    fireEvent.click(run())
    await screen.findByText("deny_no_roles")
    const rows = within(screen.getByRole("list", { name: "Models" })).getAllByRole("listitem")
    expect(within(rows[0]).getByText("gave the reason")).toBeTruthy()
    expect(screen.queryByText("decided it")).toBeNull()
    expect(within(rows[2]).getByText("No policy applied.")).toBeTruthy()
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
  it("says the page runs as a dry run, under the builder and again under the batch", () => {
    setup()
    expect(screen.getAllByText(FOOTER)).toHaveLength(2)
  })
})

describe("WardenPlaygroundPage: View this subject", () => {
  const view = () => screen.queryByRole("link", { name: "View this subject" })

  it("is absent until the subject id is filled", () => {
    setup()
    expect(view()).toBeNull()
  })

  it("links to the subject once both fields are filled, with the id encoded", () => {
    setup()
    fill("Subject id", "a/b c")
    expect(view()?.getAttribute("href")).toBe("/subjects/user/a%2Fb%20c")
  })

  it("follows the kind", () => {
    setup()
    fill("Subject id", "ci")
    fill("Subject kind", "service")
    expect(view()?.getAttribute("href")).toBe("/subjects/service/ci")
  })

  it("is absent when the kind is empty, which the route cannot carry", async () => {
    const detail: CheckDetail = {
      id: "chk_nokind",
      namespacePath: "",
      subjectKind: "",
      subjectId: "deployer",
      action: "admin",
      resourceType: "cluster",
      resourceId: "prod",
      decision: "allow",
      evalTimeNs: 1000,
      cached: false,
      createdAt: "2026-09-23T10:00:00Z",
      matchedBy: [],
      obligations: [],
    }
    const { client } = recordingQueryClient(answers({ "checkLogs.detail": detail }))
    renderPage(WardenPlaygroundPage, client, { checkId: "chk_nokind" })
    await waitFor(() => expect((screen.getByLabelText("Subject id") as HTMLInputElement).value).toBe("deployer"))
    expect((screen.getByLabelText("Subject kind") as HTMLSelectElement).value).toBe("")
    expect(view()).toBeNull()
  })
})

describe("WardenPlaygroundPage: the batch", () => {
  const BATCH_FOOTER = FOOTER
  const USAGE = "Line 2 is not kind:id action type[:id]."
  const RESULTS = {
    results: [
      { decision: "allow", allowed: true },
      { decision: "deny_default", allowed: false, reason: "no role grants it" },
      { decision: "error", allowed: false, error: "store unavailable" },
    ],
  }
  const LINES = ["user:alice read document:d1", ":bob write folder", "service:ci deploy env:prod:blue"]

  function batchSetup(extra: Record<string, unknown> = {}) {
    const { client, sent } = recordingQueryClient(
      answers({ "playground.batchCheck": RESULTS, "config.detail": { maxBatchChecks: 100 }, ...extra }),
    )
    const view = renderPage(WardenPlaygroundPage, client)
    const batches = () =>
      sent.filter((s) => s.intent === "playground.batchCheck").map((s) => s.params as Record<string, unknown>)
    return { ...view, client, sent, batches }
  }

  /** The config read was sent and has had time to settle. */
  async function configRead(sent: { intent: string }[]) {
    await waitFor(() => expect(sent.some((s) => s.intent === "config.detail")).toBe(true))
    await new Promise((r) => setTimeout(r, 20))
  }

  const typeBatch = (text: string) =>
    fireEvent.change(screen.getByLabelText("Checks, one per line"), { target: { value: text } })
  const runBatch = () => fireEvent.click(screen.getByRole("button", { name: "Run batch" }))

  /** A batch client whose batchCheck is refused. */
  function refusing(error: ContractError, config: Record<string, unknown> | undefined) {
    const inner = stubClient({
      "playground.explain": DENIED,
      "namespaces.list": NAMESPACES,
      ...(config ? { "config.detail": config } : {}),
    })
    const sent: unknown[] = []
    const client = {
      extension: "warden",
      query: (intent: string, params?: Record<string, unknown>) => {
        if (intent === "playground.batchCheck") {
          sent.push(params)
          return Promise.reject(error)
        }
        return inner.query(intent, params)
      },
      command: inner.command,
    } as unknown as ScopedClient
    return { client, sent }
  }

  it("has a Run a batch disclosure with the footer sentence under it", () => {
    batchSetup()
    const details = screen.getByText("Run a batch").closest("details") as HTMLElement
    expect(within(details).getByText(BATCH_FOOTER)).toBeTruthy()
  })

  it("keeps Run batch disabled until there is a line", () => {
    batchSetup()
    const button = screen.getByRole("button", { name: "Run batch" }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    typeBatch("  \n\n ")
    expect(button.disabled).toBe(true)
    typeBatch(LINES[0]!)
    expect(button.disabled).toBe(false)
  })

  it("sends the builder's namespace and every line as an item, in order", async () => {
    const t = batchSetup()
    fill("Namespace", "eng/platform")
    typeBatch([LINES[0], "", LINES[1], "user:a:b  read   doc\r", LINES[2]].join("\n"))
    runBatch()
    await screen.findByText("no role grants it")
    expect(t.batches()).toEqual([
      {
        namespacePath: "eng/platform",
        items: [
          { subjectKind: "user", subjectId: "alice", action: "read", resourceType: "document", resourceId: "d1" },
          { subjectKind: "", subjectId: "bob", action: "write", resourceType: "folder" },
          { subjectKind: "user", subjectId: "a:b", action: "read", resourceType: "doc" },
          { subjectKind: "service", subjectId: "ci", action: "deploy", resourceType: "env", resourceId: "prod:blue" },
        ],
      },
    ])
    expect("resourceId" in (t.batches()[0]!.items as object[])[1]!).toBe(false)
  })

  it("sends the root as an empty path, typed as / or left blank", async () => {
    const t = batchSetup()
    typeBatch(LINES[0]!)
    runBatch()
    await waitFor(() => expect(t.batches()).toHaveLength(1))
    expect(t.batches()[0]!.namespacePath).toBe("")
    fill("Namespace", "/")
    typeBatch(LINES[0]! + " ")
    runBatch()
    await waitFor(() => expect(t.batches()).toHaveLength(2))
    expect(t.batches()[1]!.namespacePath).toBe("")
  })

  it.each([
    ["a subject with no colon", "user read doc"],
    ["an empty subject id", "user: read doc"],
    ["two fields", "user:alice read"],
    ["four fields", "user:alice read doc extra"],
    ["an empty resource type", "user:alice read :d1"],
  ])("refuses %s, naming the line, and sends nothing", async (_name, bad) => {
    const t = batchSetup()
    typeBatch(`${LINES[0]}\n${bad}`)
    runBatch()
    expect(await screen.findByText(USAGE)).toBeTruthy()
    expect(t.batches()).toHaveLength(0)
  })

  it("counts blank lines when it names the bad one", async () => {
    const t = batchSetup()
    typeBatch(`${LINES[0]}\n\nnope`)
    runBatch()
    expect(await screen.findByText("Line 3 is not kind:id action type[:id].")).toBeTruthy()
    expect(t.batches()).toHaveLength(0)
  })

  it("names the first bad line only", async () => {
    batchSetup()
    typeBatch("nope\nalso nope")
    runBatch()
    expect(await screen.findByText("Line 1 is not kind:id action type[:id].")).toBeTruthy()
    expect(screen.queryByText(/^Line 2 is not/)).toBeNull()
  })

  it("clears the refusal once a good batch is sent", async () => {
    batchSetup()
    typeBatch("nope")
    runBatch()
    await screen.findByText(/^Line 1 is not/)
    typeBatch(LINES[0]!)
    runBatch()
    await waitFor(() => expect(screen.queryByText(/^Line 1 is not/)).toBeNull())
  })

  it("says how many checks a batch holds, and sends nothing, when there are more lines", async () => {
    const t = batchSetup({ "config.detail": { maxBatchChecks: 2 } })
    await configRead(t.sent)
    typeBatch(LINES.join("\n"))
    runBatch()
    expect(await screen.findByText("A batch holds at most 2 checks.")).toBeTruthy()
    expect(t.batches()).toHaveLength(0)
  })

  it("does not count blank lines against the cap", async () => {
    const t = batchSetup({ "config.detail": { maxBatchChecks: 2 } })
    await configRead(t.sent)
    typeBatch(`${LINES[0]}\n\n\n${LINES[1]}\n\n`)
    runBatch()
    await waitFor(() => expect(t.batches()).toHaveLength(1))
    expect(screen.queryByText(/A batch holds at most/)).toBeNull()
  })

  it("does not pre-check when the config reports 0, and shows the server's refusal instead", async () => {
    const { client, sent } = refusing(
      new ContractError("BAD_REQUEST", "a batch holds at most 100 checks"),
      { maxBatchChecks: 0 },
    )
    renderPage(WardenPlaygroundPage, client)
    await new Promise((r) => setTimeout(r, 20))
    typeBatch(Array.from({ length: 150 }, () => LINES[0]).join("\n"))
    runBatch()
    expect(await screen.findByText("a batch holds at most 100 checks")).toBeTruthy()
    expect(sent).toHaveLength(1)
    expect(screen.queryByText(/^A batch holds at most/)).toBeNull()
  })

  it("does not pre-check when the config cannot be read, and shows the server's refusal instead", async () => {
    const { client, sent } = refusing(
      new ContractError("BAD_REQUEST", "a batch holds at most 100 checks"),
      undefined,
    )
    renderPage(WardenPlaygroundPage, client)
    typeBatch(LINES.join("\n"))
    runBatch()
    expect(await screen.findByText("a batch holds at most 100 checks")).toBeTruthy()
    expect(sent).toHaveLength(1)
  })

  it("shows a server refusal in the batch section, not over the builder's Run", async () => {
    const { client } = refusing(new ContractError("BAD_REQUEST", "items[1].subjectId is required"), {
      maxBatchChecks: 100,
    })
    renderPage(WardenPlaygroundPage, client)
    typeBatch(LINES[0]!)
    runBatch()
    const alert = await screen.findByRole("alert")
    const details = screen.getByText("Run a batch").closest("details") as HTMLElement
    expect(details.contains(alert)).toBe(true)
    expect(alert.textContent).toContain("items[1].subjectId is required")
  })

  it("lists the results in line order with the decision, and the reason or error", async () => {
    batchSetup()
    typeBatch(["user:alice read document:d1", "", ":bob write folder", "service:ci deploy env:prod:blue"].join("\n"))
    runBatch()
    await screen.findByText("no role grants it")
    const table = screen.getByRole("region", { name: "3 checks" })
    const rows = Array.from(table.querySelectorAll("tbody tr"))
    expect(rows).toHaveLength(3)
    const text = (tr: Element) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent)
    expect(text(rows[0]!).slice(0, 3)).toEqual(["1", "user:alice read document:d1", "allow"])
    expect(text(rows[1]!).slice(0, 4)).toEqual(["3", ":bob write folder", "deny_default", "no role grants it"])
    expect(text(rows[2]!).slice(0, 4)).toEqual(["4", "service:ci deploy env:prod:blue", "error", "store unavailable"])
    const badge = (tr: Element) => tr.querySelector("[data-slot='badge']")?.getAttribute("data-variant")
    expect(rows.map(badge)).toEqual(["outline", "secondary", "destructive"])
    expect(rows[2]!.querySelectorAll("td")[3]!.querySelector(".text-destructive")?.textContent).toBe("store unavailable")
    expect(rows[1]!.querySelectorAll("td")[3]!.querySelector(".text-muted-foreground")?.textContent).toBe("no role grants it")
    expect(rows[0]!.querySelector("[aria-label='no detail']")).toBeTruthy()
  })

  it("fills the builder with a line when Open in builder is pressed", async () => {
    batchSetup()
    typeBatch(LINES.join("\n"))
    runBatch()
    await screen.findByText("no role grants it")
    const buttons = screen.getAllByRole("button", { name: /^Open in builder/ })
    expect(buttons).toHaveLength(3)
    fireEvent.click(buttons[2]!)
    expect(value("Subject kind")).toBe("service")
    expect(value("Subject id")).toBe("ci")
    expect(value("Action")).toBe("deploy")
    expect(value("Resource type")).toBe("env")
    expect(value("Resource id")).toBe("prod:blue")
  })

  it("clears the builder's resource id when the line has none, and offers a kind the select lacks", async () => {
    batchSetup()
    fill("Resource id", "left-over")
    typeBatch(LINES.join("\n"))
    runBatch()
    await screen.findByText("no role grants it")
    fireEvent.click(screen.getAllByRole("button", { name: /^Open in builder/ })[1]!)
    expect(value("Subject kind")).toBe("")
    expect(value("Subject id")).toBe("bob")
    expect(value("Resource type")).toBe("folder")
    expect(value("Resource id")).toBe("")
  })

  it("leaves the builder's namespace and JSON fields alone", async () => {
    batchSetup()
    fill("Namespace", "eng/platform")
    fill("Context", '{"ip": "10.0.0.1"}')
    typeBatch(LINES[0]!)
    runBatch()
    await screen.findByRole("button", { name: /^Open in builder/ })
    fireEvent.click(screen.getAllByRole("button", { name: /^Open in builder/ })[0]!)
    expect(value("Namespace")).toBe("eng/platform")
    expect(value("Context")).toBe('{"ip": "10.0.0.1"}')
  })

  it("counts as an edit, so a check prefill that arrives later does not overwrite it", async () => {
    let release: (d: CheckDetail) => void = () => {}
    const client = {
      extension: "warden",
      query: (intent: string) =>
        intent === "checkLogs.detail"
          ? new Promise<CheckDetail>((resolve) => {
              release = resolve
            })
          : Promise.resolve(
              intent === "namespaces.list"
                ? NAMESPACES
                : intent === "config.detail"
                  ? { maxBatchChecks: 100 }
                  : intent === "playground.batchCheck"
                    ? RESULTS
                    : DENIED,
            ),
      command: async () => undefined,
    } as unknown as ScopedClient
    renderPage(WardenPlaygroundPage, client, { checkId: "chk_01a" })
    typeBatch(LINES.join("\n"))
    runBatch()
    await screen.findByText("no role grants it")
    fireEvent.click(screen.getAllByRole("button", { name: /^Open in builder/ })[0]!)
    release({
      id: "chk_01a",
      namespacePath: "eng/platform",
      subjectKind: "service",
      subjectId: "deployer",
      action: "admin",
      resourceType: "cluster",
      resourceId: "prod",
      decision: "allow",
      evalTimeNs: 1,
      cached: false,
      createdAt: "2026-09-23T10:00:00Z",
      matchedBy: [],
      obligations: [],
    })
    await waitFor(() => expect(value("Namespace")).toBe("eng/platform"))
    expect(value("Subject id")).toBe("alice")
    expect(value("Action")).toBe("read")
    expect(value("Resource type")).toBe("document")
    expect(value("Resource id")).toBe("d1")
  })

  describe("a result the lines or namespace have moved on from", () => {
    const CHANGED =
      "The lines or namespace have changed since this run. Run the batch again to check them."

    async function ran(text = LINES.join("\n")) {
      const t = batchSetup()
      typeBatch(text)
      runBatch()
      await screen.findByText("no role grants it")
      return t
    }

    it("says nothing before anything changes", async () => {
      await ran()
      expect(screen.queryByText(CHANGED)).toBeNull()
    })

    it("appears above the table, which stays, when a line is edited", async () => {
      await ran()
      typeBatch(LINES.join("\n").replace("read", "view"))
      const note = screen.getByText(CHANGED)
      expect(note.className).toContain("text-muted-foreground")
      const table = screen.getByRole("region", { name: "3 checks" })
      expect(note.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(screen.getByText("no role grants it")).toBeTruthy()
    })

    it("appears when a line is removed, or the text stops parsing", async () => {
      await ran()
      typeBatch(LINES.slice(0, 2).join("\n"))
      expect(screen.getByText(CHANGED)).toBeTruthy()
      typeBatch(LINES.join("\n"))
      expect(screen.queryByText(CHANGED)).toBeNull()
      typeBatch("nope")
      expect(screen.getByText(CHANGED)).toBeTruthy()
    })

    it("appears when the builder's namespace changes", async () => {
      await ran()
      fill("Namespace", "eng/platform")
      expect(screen.getByText(CHANGED)).toBeTruthy()
      expect(screen.getByText("no role grants it")).toBeTruthy()
    })

    it("does not count / against a root run, or whitespace-only edits", async () => {
      await ran()
      fill("Namespace", "/")
      expect(screen.queryByText(CHANGED)).toBeNull()
      typeBatch(`\n  ${LINES[0]}  \n\n${LINES[1]}\t\n${LINES[2]}\n\n`)
      expect(screen.queryByText(CHANGED)).toBeNull()
    })

    it("clears on the next run", async () => {
      const t = await ran()
      fill("Namespace", "eng/platform")
      expect(screen.getByText(CHANGED)).toBeTruthy()
      runBatch()
      await waitFor(() => expect(t.batches()).toHaveLength(2))
      await waitFor(() => expect(screen.queryByText(CHANGED)).toBeNull())
      expect(screen.getByText("no role grants it")).toBeTruthy()
    })
  })

  describe("a local refusal is the only answer on screen", () => {
    it("clears the previous run's results when a line does not parse", async () => {
      batchSetup()
      typeBatch(LINES.join("\n"))
      runBatch()
      await screen.findByText("no role grants it")
      typeBatch("nope")
      runBatch()
      expect(await screen.findByText("Line 1 is not kind:id action type[:id].")).toBeTruthy()
      expect(screen.queryByRole("region", { name: "3 checks" })).toBeNull()
      expect(screen.queryByText("no role grants it")).toBeNull()
      expect(screen.queryByText(/have changed since this run/)).toBeNull()
    })

    it("clears the previous run's results when the batch is over the cap", async () => {
      const t = batchSetup({ "config.detail": { maxBatchChecks: 2 } })
      await configRead(t.sent)
      typeBatch(LINES.slice(0, 2).join("\n"))
      runBatch()
      await screen.findByText("no role grants it")
      typeBatch(LINES.join("\n"))
      runBatch()
      expect(await screen.findByText("A batch holds at most 2 checks.")).toBeTruthy()
      expect(screen.queryByRole("region", { name: /checks$/ })).toBeNull()
      expect(screen.queryByText("no role grants it")).toBeNull()
    })

    it("clears the previous run's server refusal", async () => {
      let refuse = true
      const inner = stubClient({
        "playground.explain": DENIED,
        "namespaces.list": NAMESPACES,
        "config.detail": { maxBatchChecks: 100 },
      })
      const client = {
        extension: "warden",
        query: (intent: string, params?: Record<string, unknown>) =>
          intent === "playground.batchCheck" && refuse
            ? Promise.reject(new ContractError("BAD_REQUEST", "the server said no"))
            : inner.query(intent, params),
        command: inner.command,
      } as unknown as ScopedClient
      renderPage(WardenPlaygroundPage, client)
      typeBatch(LINES[0]!)
      runBatch()
      expect(await screen.findByText("the server said no")).toBeTruthy()
      refuse = false
      typeBatch("nope")
      runBatch()
      await screen.findByText("Line 1 is not kind:id action type[:id].")
      expect(screen.queryByText("the server said no")).toBeNull()
      expect(screen.getAllByRole("alert")).toHaveLength(1)
    })
  })

  it("sends a second request when Run batch is pressed again with the same lines", async () => {
    const t = batchSetup()
    typeBatch(LINES[0]!)
    runBatch()
    await waitFor(() => expect(t.batches()).toHaveLength(1))
    await waitFor(() => expect((screen.getByRole("button", { name: "Run batch" }) as HTMLButtonElement).disabled).toBe(false))
    runBatch()
    await waitFor(() => expect(t.batches()).toHaveLength(2))
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

  it("sends a request when only the key order inside a JSON field changed", async () => {
    // The store's key sorts object keys, so this is the same key. Run must
    // still reach the server.
    const t = setup()
    fillRequired()
    fill("Context", '{"a": 1, "b": 2}')
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
    await waitFor(() => expect((run() as HTMLButtonElement).disabled).toBe(false))
    fill("Context", '{"b": 2, "a": 1}')
    fireEvent.click(run())
    await waitFor(() => expect(t.explains()).toHaveLength(2))
    await screen.findByText("deny_explicit")
    expect(t.explains()[1].context).toEqual({ a: 1, b: 2 })
  })
})

describe("WardenPlaygroundPage: a result the form has moved on from", () => {
  const CHANGED = "The form has changed since this run. Run it again to check the new input."

  async function ran() {
    const t = setup()
    fillRequired()
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
    return t
  }

  it("says nothing before the form changes", async () => {
    await ran()
    expect(screen.queryByText(CHANGED)).toBeNull()
  })

  it("appears above the verdict after an edit, and keeps the result visible", async () => {
    await ran()
    fill("Action", "export")
    const note = screen.getByText(CHANGED)
    expect(note.className).toContain("text-muted-foreground")
    expect(screen.getByText("deny_explicit")).toBeTruthy()
    expect(screen.getByText("An explicit deny overrides the RBAC allow.")).toBeTruthy()
    expect(
      note.compareDocumentPosition(screen.getByText("deny_explicit")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      note.compareDocumentPosition(screen.getByText("An explicit deny overrides the RBAC allow.")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it("appears after a JSON validation failure, since that input was never sent", async () => {
    const t = await ran()
    fill("Context", "{nope")
    fireEvent.click(run())
    expect(screen.getByText(NOT_JSON)).toBeTruthy()
    expect(screen.getByText(CHANGED)).toBeTruthy()
    expect(t.explains()).toHaveLength(1)
  })

  it("clears after the next run", async () => {
    const t = await ran()
    fill("Action", "export")
    expect(screen.getByText(CHANGED)).toBeTruthy()
    fireEvent.click(run())
    await waitFor(() => expect(t.explains()).toHaveLength(2))
    await screen.findByText("deny_explicit")
    expect(screen.queryByText(CHANGED)).toBeNull()
  })

  it("clears when the edit is put back", async () => {
    await ran()
    fill("Action", "export")
    expect(screen.getByText(CHANGED)).toBeTruthy()
    fill("Action", "delete")
    expect(screen.queryByText(CHANGED)).toBeNull()
  })
})

describe("WardenPlaygroundPage: opened from a check log row", () => {
  const LOGGED: CheckDetail = {
    id: "chk_01a",
    namespacePath: "eng/platform",
    subjectKind: "service",
    subjectId: "deployer",
    action: "admin",
    resourceType: "cluster",
    resourceId: "prod",
    decision: "allow",
    evalTimeNs: 402_000,
    cached: false,
    createdAt: "2026-09-23T10:00:00Z",
    matchedBy: [],
    obligations: [],
  }
  const NOTICE = (at: string) =>
    `Prefilled from a check logged at ${formatTimestamp(at)}. The check log does not record context or attributes, so add any the original check carried.`

  function opened(detail: CheckDetail = LOGGED) {
    const { client, sent } = recordingQueryClient(answers({ "checkLogs.detail": detail }))
    const view = renderPage(WardenPlaygroundPage, client, { checkId: detail.id })
    const explains = () => sent.filter((s) => s.intent === "playground.explain")
    return { ...view, sent, explains }
  }

  it("asks for the check named in the route", async () => {
    const t = opened()
    await waitFor(() => expect(value("Subject id")).toBe("deployer"))
    expect(t.sent.find((s) => s.intent === "checkLogs.detail")?.params).toEqual({ id: "chk_01a" })
  })

  it("fills the six fields once the detail arrives, and leaves the JSON fields empty", async () => {
    opened()
    await waitFor(() => expect(value("Subject id")).toBe("deployer"))
    expect(value("Subject kind")).toBe("service")
    expect(value("Action")).toBe("admin")
    expect(value("Resource type")).toBe("cluster")
    expect(value("Resource id")).toBe("prod")
    expect(value("Namespace")).toBe("eng/platform")
    for (const label of ["Subject attributes", "Resource attributes", "Context"]) {
      expect((screen.getByLabelText(label) as HTMLTextAreaElement).value).toBe("")
    }
  })

  it.each([
    { kind: "", shown: "(no kind)" },
    { kind: "robot", shown: "robot" },
  ])("keeps a logged subject kind shown as $shown outside the four, shows it, and runs with it", async ({ kind, shown }) => {
    const t = opened({ ...LOGGED, subjectKind: kind })
    await waitFor(() => expect(value("Subject id")).toBe("deployer"))
    const select = screen.getByLabelText("Subject kind") as HTMLSelectElement
    expect(select.value).toBe(kind)
    expect(select.selectedOptions[0].textContent).toBe(shown)
    expect(within(select).getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual([
      "user",
      "api_key",
      "service",
      "service_acct",
      kind,
    ])
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
    expect(t.explains()[0].params).toMatchObject({ subjectKind: kind })
  })

  it("offers only the four kinds when the logged kind is one of them", async () => {
    opened()
    await waitFor(() => expect(value("Subject id")).toBe("deployer"))
    expect(within(screen.getByLabelText("Subject kind")).getAllByRole("option")).toHaveLength(4)
  })

  it("shows the root as / and sends it as an empty path", async () => {
    const t = opened({ ...LOGGED, namespacePath: "" })
    await waitFor(() => expect(value("Namespace")).toBe("/"))
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
    expect(t.explains()[0].params).toEqual({
      subjectKind: "service",
      subjectId: "deployer",
      action: "admin",
      resourceType: "cluster",
      resourceId: "prod",
      namespacePath: "",
    })
  })

  it("does not run until the operator presses Run, and shows no result or stale note", async () => {
    const t = opened()
    await waitFor(() => expect(value("Subject id")).toBe("deployer"))
    // Give a wrongly automatic run every chance to happen.
    await new Promise((r) => setTimeout(r, 50))
    expect(t.explains()).toHaveLength(0)
    expect(screen.queryByText("deny_explicit")).toBeNull()
    expect(screen.queryByRole("list", { name: "Models" })).toBeNull()
    expect(screen.queryByText(/The form has changed since this run/)).toBeNull()
    expect((run() as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
    expect(t.explains()).toHaveLength(1)
  })

  it("says the form was prefilled, and what the check log does not record", async () => {
    const { container } = opened()
    await waitFor(() => expect(value("Subject id")).toBe("deployer"))
    const notice = screen.getByText(/^Prefilled from a check logged at/)
    expect(notice.textContent).toBe(NOTICE(LOGGED.createdAt))
    // Above the form.
    expect(
      notice.compareDocumentPosition(container.querySelector("form")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it("prefills a check that failed too", async () => {
    opened({ ...LOGGED, decision: "error", error: "store unavailable" })
    await waitFor(() => expect(value("Subject id")).toBe("deployer"))
    expect(screen.getByText(/^Prefilled from a check logged at/)).toBeTruthy()
  })

  it("does not overwrite a field the operator edited before the detail arrived", async () => {
    let release: (d: CheckDetail) => void = () => {}
    const client = {
      extension: "warden",
      query: (intent: string) =>
        intent === "checkLogs.detail"
          ? new Promise<CheckDetail>((resolve) => {
              release = resolve
            })
          : Promise.resolve(intent === "namespaces.list" ? NAMESPACES : DENIED),
      command: async () => undefined,
    } as unknown as ScopedClient
    renderPage(WardenPlaygroundPage, client, { checkId: "chk_01a" })
    fill("Action", "export")
    release(LOGGED)
    await waitFor(() => expect(value("Subject id")).toBe("deployer"))
    expect(value("Action")).toBe("export")
    expect(value("Resource type")).toBe("cluster")
    expect(screen.getByText(/^Prefilled from a check logged at/)).toBeTruthy()
  })

  it("prefills once: a later edit is not undone", async () => {
    opened()
    await waitFor(() => expect(value("Subject id")).toBe("deployer"))
    fill("Action", "export")
    await new Promise((r) => setTimeout(r, 50))
    expect(value("Action")).toBe("export")
  })

  it("shows the error card when the check is not found, with the empty builder usable below it", async () => {
    const client = stubClient({
      "playground.explain": DENIED,
      "namespaces.list": NAMESPACES,
    })
    // stubClient refuses checkLogs.detail with NOT_FOUND, as the server does for an unknown id.
    renderPage(WardenPlaygroundPage, client, { checkId: "chk_missing" })
    expect(await screen.findByText("Check unavailable")).toBeTruthy()
    expect(screen.getByText(/NOT_FOUND/)).toBeTruthy()
    expect(screen.queryByText(/^Prefilled from a check logged at/)).toBeNull()
    expect(value("Subject id")).toBe("")
    fillRequired()
    fireEvent.click(run())
    await screen.findByText("deny_explicit")
  })

  it("asks for no check, and shows no notice, at the plain route", async () => {
    const t = setup()
    await waitFor(() => expect(t.sent.some((s) => s.intent === "namespaces.list")).toBe(true))
    expect(t.sent.some((s) => s.intent === "checkLogs.detail")).toBe(false)
    expect(screen.queryByText(/^Prefilled from a check logged at/)).toBeNull()
  })
})
