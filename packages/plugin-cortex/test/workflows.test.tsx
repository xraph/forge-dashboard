import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import {
  PluginProvider,
  NavigationProvider,
  createScopedClient,
  type ContractEnvelopeRequest,
} from "@forge-go/dashboard-plugin"
import plugin from "../src/index"
import { changedFields, FieldControl } from "../src/form"
import { schemas, type Field } from "../src/schema"
import { ConfigEdit, ConfigList } from "../src/pages/configuration"
import { CatalogPage } from "../src/pages/integrations"

vi.mock("../src/editor", () => ({
  default: ({
    text,
    label,
    onChange,
  }: {
    text: string
    label: string
    onChange?: (v: string) => void
  }) => (
    <textarea
      aria-label={label}
      value={text}
      readOnly={!onChange}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}))
const ok = (data: unknown) => ({ envelope: "v1", ok: true, data })
const fail = (code: string, message: string) => ({
  envelope: "v1",
  ok: false,
  error: { code, message },
})
const agent = {
  id: "agt_review",
  name: "reviewer",
  description: "Keep this",
  scope: { levels: [{ key: "tenant", value: "a" }] },
  enabled: true,
  model: "model",
  tools: ["read"],
  persona_ref: "operator",
  inline_skills: ["analysis"],
  inline_traits: [],
  inline_behaviors: [],
  sections: [
    { id: "role", body: "Original", order: 1, source: "host", locked: true },
  ],
  metadata: { owner: "operator" },
  created_at: "2026-10-08T12:00:00Z",
}
function mount(
  node: React.ReactNode,
  answer: (req: ContractEnvelopeRequest) => unknown | Promise<unknown>,
  manage = true
) {
  const requests: ContractEnvelopeRequest[] = []
  const client = createScopedClient(
    "/dashboard/api/dashboard/v1",
    "cortex",
    vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.body)
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: "test" }),
        } as Response
      const req = JSON.parse(String(init.body)) as ContractEnvelopeRequest
      requests.push(req)
      const value =
        req.intent === "runtime.detail"
          ? ok({
              permissions: { read: true, manage, run: manage, approve: manage },
              llm: true,
            })
          : await answer(req)
      return { ok: true, status: 200, json: async () => value } as Response
    })
  )
  render(
    <NavigationProvider
      value={{
        Link: ({ to, children }) => <a href={to}>{children}</a>,
        navigate: vi.fn(),
      }}
    >
      <PluginProvider client={client}>{node}</PluginProvider>
    </NavigationProvider>
  )
  return requests
}

describe("Cortex workflows", () => {
  it("registers every navigation target and configuration edit route", () => {
    const paths = plugin.routes.map((r) => r.path)
    for (const nav of plugin.nav) expect(paths).toContain(nav.to)
    for (const resource of Object.keys(schemas))
      expect(paths).toContain(`/${resource}/:id/edit`)
    expect(paths).toContain("/runs/:id")
    expect(paths).toContain("/checkpoints/:id")
    expect(paths).toContain("/playground/:agentId")
  })
  it("sends an explicit clear and preserves omitted nested fields", async () => {
    const requests = mount(
      <ConfigEdit resource="agents" id={agent.id} />,
      (req) =>
        req.intent === "agents.detail"
          ? ok(agent)
          : req.intent === "references.list"
            ? ok({ items: [], total: 0 })
            : ok(agent)
    )
    await screen.findByDisplayValue("Keep this")
    fireEvent.click(screen.getByText("Tool allowlist", { selector: "summary" }))
    fireEvent.click(
      screen.getByRole("button", { name: "Remove tool allowlist 1" })
    )
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Save configuration" })[0]
      ).toHaveProperty("disabled", false)
    )
    fireEvent.click(
      screen.getAllByRole("button", { name: "Save configuration" })[0]!
    )
    await waitFor(() =>
      expect(requests.some((r) => r.intent === "agents.update")).toBe(true)
    )
    const req = requests.find((r) => r.intent === "agents.update")!
    expect(req.payload).toEqual({ id: agent.id, patch: { tools: [] } })
    await waitFor(() =>
      expect(
        requests.find((r) => r.intent === "references.list")?.params
      ).toMatchObject({ owner_kind: "agents", owner_id: agent.id })
    )
  })
  it("keeps a delete error inside the confirmation and allows retry", async () => {
    let attempts = 0
    const requests = mount(<ConfigList resource="agents" />, (req) =>
      req.intent === "agents.list"
        ? ok({ items: [agent], total: 1, limit: 25, offset: 0 })
        : ++attempts === 1
          ? fail("CONFLICT", "Agent is still referenced")
          : ok({ deleted: true })
    )
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect(
      await within(dialog).findByText("Agent is still referenced")
    ).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(requests.filter((r) => r.intent === "agents.delete")).toHaveLength(2)
  })
  it("does not expose management controls to a reader", async () => {
    mount(
      <ConfigList resource="agents" />,
      () => ok({ items: [agent], total: 1 }),
      false
    )
    await screen.findByText("reviewer")
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
    expect(screen.queryByRole("link", { name: "New agent" })).toBeNull()
  })
  it("distinguishes missing providers from failed providers", async () => {
    let failed = false
    mount(<CatalogPage kind="knowledge" />, () =>
      failed
        ? fail("UNAVAILABLE", "Store connection failed")
        : ok({ available: false, reason: "Weave is not configured", items: [] })
    )
    expect(await screen.findByText("Weave is not configured")).toBeTruthy()
    failed = true
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    expect(await screen.findByText(/Store connection failed/)).toBeTruthy()
  })
  it("patches only changed fields, including false and zero", () => {
    const initial = { ...agent, max_steps: 8 }
    expect(
      changedFields(
        initial,
        {
          ...initial,
          name: "ignored",
          enabled: false,
          max_steps: 0,
          sections: [],
        },
        schemas.agents.fields
      )
    ).toEqual({ enabled: false, max_steps: 0, sections: [] })
  })
})

function ValueHarness() {
  const [value, setValue] = useState<unknown>({ threshold: 0.5 }),
    [valid, setValid] = useState(true)
  const field: Field = { key: "value", label: "Action value", kind: "value" }
  return (
    <>
      <FieldControl
        field={field}
        value={value}
        onChange={setValue}
        path="action.value"
        onValidity={(_path, v) => setValid(v)}
      />
      <output>{JSON.stringify(value)}</output>
      <button disabled={!valid}>Save value</button>
    </>
  )
}
it("edits arbitrary nested action values and blocks malformed JSON", async () => {
  render(<ValueHarness />)
  const input = await screen.findByRole("textbox", { name: "Action value" })
  fireEvent.change(input, {
    target: { value: '{"nested":[1,false,{"source":"manual"}]}' },
  })
  expect(screen.getByRole("status").textContent).toContain('"source":"manual"')
  fireEvent.change(input, { target: { value: '{"nested":' } })
  expect(screen.getByRole("alert")).toBeTruthy()
  expect(screen.getByRole("button", { name: "Save value" })).toHaveProperty(
    "disabled",
    true
  )
  fireEvent.change(input, { target: { value: "[1,2]" } })
  expect(screen.getByRole("button", { name: "Save value" })).toHaveProperty(
    "disabled",
    false
  )
})
