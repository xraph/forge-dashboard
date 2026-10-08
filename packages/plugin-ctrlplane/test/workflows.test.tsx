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
  PluginProvider,
  createScopedClient,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type { ContractEnvelopeRequest } from "@forge-go/dashboard-plugin"
import { CommandButton, payloadFor, initialValues } from "../src/components"
import { ResourceList, ResourceDetail } from "../src/pages"
import plugin from "../src/index"
import { resources, routeFields, deployFields } from "../src/resources"

beforeEach(() => queryStore.clear())
afterEach(cleanup)
function mount(
  page: React.ReactNode,
  answer: (req: ContractEnvelopeRequest) => unknown
) {
  const requests: ContractEnvelopeRequest[] = []
  const client = createScopedClient(
    "/dashboard/api/dashboard/v1",
    "ctrlplane",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.body)
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: "test" }),
        } as Response
      const req = JSON.parse(String(init?.body)) as ContractEnvelopeRequest
      requests.push(req)
      const value = answer(req)
      return { ok: true, status: 200, json: async () => value } as Response
    })
  )
  render(<PluginProvider client={client}>{page}</PluginProvider>)
  return requests
}
const success = (data: unknown) => ({ envelope: "v1", ok: true, data })
const failure = {
  envelope: "v1",
  ok: false,
  error: {
    code: "CONFLICT",
    message: "Provider refused teardown. Retry after recovery.",
  },
}

describe("Ctrlplane workflows", () => {
  it("registers every navigation target and authoring route", () => {
    const paths = plugin.routes.map((r) => r.path)
    for (const nav of plugin.nav) expect(paths).toContain(nav.to)
    expect(paths).toContain("/templates/:id/edit")
    expect(paths).toContain("/datacenters/:id/edit")
    expect(plugin.extension).toBe("ctrlplane")
  })
  it("preserves multiple services, secret references and typed sources during edits", () => {
    const services = [
      {
        name: "api",
        image: "api:2",
        role: "main",
        secrets: [{ key: "PASSWORD", env_var: "DB_PASSWORD" }],
      },
      {
        name: "metrics",
        image: "metrics:1",
        role: "sidecar",
        env: { MODE: "demo" },
      },
    ]
    const values = initialValues(resources.templates.edit!, {
      name: "Orders",
      services,
      source: {
        type: "services",
        services: [{ name: "api", image: "api:old" }],
      },
    })
    const body = payloadFor(resources.templates.edit!, values)
    expect(body.services).toEqual(services)
    expect(body.source).toEqual({ type: "services", services })
    values.source = JSON.stringify({
      type: "helm",
      helm: { chart: "orders", values: { workers: 3 } },
    })
    expect(payloadFor(resources.templates.edit!, values).source).toEqual({
      type: "helm",
      helm: { chart: "orders", values: { workers: 3 } },
    })
  })
  it("projects deployment overrides onto supported fields and strategy names", () => {
    const values = initialValues(deployFields, {
      services: [
        {
          name: "api",
          image: "api:2",
          role: "main",
          resources: { cpu_millis: 500 },
          env: { MODE: "prod" },
        },
      ],
    })
    expect(payloadFor(deployFields, values).services).toEqual([
      { name: "api", image: "api:2", env: { MODE: "prod" } },
    ])
    expect(
      deployFields.find((field) => field.key === "strategy")?.options
    ).toContain("blue-green")
    values.services = [
      { name: "api", image: "api:2", resources: { cpu_millis: 1000 } },
    ]
    expect(() => payloadFor(deployFields, values)).toThrow(
      "Deployments support"
    )
  })
  it("resets an empty filtered selection from the empty state", async () => {
    mount(<ResourceList kind="workloads" />, (req) =>
      success({
        items: req.params?.state ? [] : [{ id: "wkl_demo", name: "Orders" }],
      })
    )
    await screen.findByText("Orders")
    fireEvent.change(screen.getByLabelText("Filter state"), {
      target: { value: "missing" },
    })
    await screen.findByText("No workloads found.")
    fireEvent.click(screen.getByRole("button", { name: "Reset selection" }))
    await screen.findByText("Orders")
    expect(screen.getByLabelText("Filter state")).toHaveProperty("value", "")
  })
  it("rejects broken JSON drafts and preserves upstream TLS defaults", () => {
    expect(() =>
      payloadFor(resources.templates.edit!, {
        name: "Orders",
        services: [{ __error: "Invalid service JSON." }],
      })
    ).toThrow("Invalid service JSON")
    const body = payloadFor(routeFields, initialValues(routeFields))
    expect(body.tls_verify).toBe(true)
    expect(body.service_name).toBeUndefined()
  })
  it("keeps teardown failures in the dialog and permits an explicit retry", async () => {
    let attempts = 0
    const requests = mount(
      <CommandButton
        action={{
          intent: "workloads.delete",
          label: "Delete workload",
          destructive: true,
        }}
        target={{ id: "wl_demo" }}
      />,
      () => (++attempts === 1 ? failure : success({ ok: true }))
    )
    fireEvent.click(screen.getByRole("button", { name: "Delete workload" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete workload" })
    )
    await screen.findByText("Provider refused teardown. Retry after recovery.")
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete workload" })
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(
      requests.filter((r) => r.intent === "workloads.delete")
    ).toHaveLength(2)
  })
  it("shows denied reads separately from empty results", async () => {
    mount(<ResourceList kind="workloads" />, () => ({
      envelope: "v1",
      ok: false,
      error: { code: "PERMISSION_DENIED", message: "Missing tenant scope" },
    }))
    await screen.findByText(/PERMISSION_DENIED: Missing tenant scope/)
    expect(screen.queryByText("No workloads found.")).toBeNull()
  })
  it("discloses bounded lists and keeps unknown state visible", async () => {
    mount(<ResourceList kind="workloads" />, () =>
      success({
        items: [
          { id: "wl_demo", name: "Orders", state: "unknown", replica_count: 2 },
        ],
        total: 51,
        complete: false,
      })
    )
    await screen.findByText("Orders")
    expect(screen.getByText(/Showing a bounded result/)).toBeTruthy()
    expect(screen.getByText("unknown")).toBeTruthy()
  })
  it("does not render uncomputed telemetry aggregates as measurements", async () => {
    mount(
      <ResourceDetail
        kind="instances"
        params={{ id: "inst_demo", section: "telemetry" }}
      />,
      (req) =>
        success(
          req.intent === "instances.detail"
            ? { id: "inst_demo", name: "Orders" }
            : { cpu_percent: 0, requests_per_sec: 0, resources: null }
        )
    )
    await screen.findByText("Only the resource snapshot", { exact: false })
    expect(screen.queryByText("Requests per sec")).toBeNull()
  })
})
