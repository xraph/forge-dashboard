import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import {
  PluginProvider,
  createScopedClient,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type { ContractEnvelopeRequest } from "@forge-go/dashboard-plugin"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import {
  ConfigPage,
  HealthPage,
  LogPage,
  OverviewPage,
  ResourceDetail,
  ResourceEditor,
  ResourceList,
  SelectionPage,
} from "../src/pages"

beforeEach(() => queryStore.clear())
afterEach(cleanup)

const success = (data: unknown) => ({ envelope: "v1", ok: true, data })

const workload = {
  id: "wkl_1",
  name: "Orders",
  state: "running",
  replica_count: 2,
  provider_name: "docker",
  region: "eu-west",
  image: "api:1",
  created_at: "2026-10-01T10:00:00Z",
}
const instance = {
  id: "inst_1",
  name: "Billing",
  state: "running",
  provider_name: "docker",
  region: "eu-west",
  image: "api:1",
  created_at: "2026-10-01T10:00:00Z",
}
const services = [{ name: "api", role: "main", image: "api:1" }]

// One answer per intent, shaped like the control plane's contract replies.
function answer(req: ContractEnvelopeRequest) {
  const next = req.params?.cursor ? undefined : "cursor-2"
  switch (req.intent) {
    case "session.detail":
      return success({ admin: true })
    case "system.stats":
      return success({ instances: 4242, workloads: 17 })
    case "workloads.list":
      return success({ items: [workload], next_cursor: next })
    case "workloads.health":
      return success({
        status: "healthy",
        healthy_count: 2,
        replica_count: 2,
        degraded_count: 0,
        unhealthy_count: 0,
        unknown_count: 0,
      })
    case "deployments.recent":
      return success({
        items: [
          {
            id: "dep_77",
            instance_id: "inst_1",
            image: "api:1",
            state: "succeeded",
            strategy: "rolling",
            created_at: "2026-10-02T10:00:00Z",
          },
        ],
      })
    case "workers.list":
      return success({
        items: [{ name: "reaper", running: true, run_count: 3 }],
      })
    case "workers.detail":
      return success({ name: "reaper", running: true, run_count: 3 })
    case "providers.list":
      return success({
        items: [
          {
            name: "docker",
            region: "eu-west",
            healthy: true,
            capabilities: ["build"],
            checked_at: "2026-10-02T10:00:00Z",
            message: "ok",
          },
        ],
      })
    case "instances.list":
      return success({ items: [instance] })
    case "instances.detail":
      return success({
        ...instance,
        labels: { "ctrlplane.workload": "wkl_1" },
        services,
        endpoints: [
          {
            service_name: "api",
            url: "http://orders.test",
            port: 80,
            protocol: "http",
            public: true,
          },
        ],
      })
    case "domains.list":
      return success({
        items: [{ id: "dom_1", hostname: "orders.example.test" }],
      })
    case "telemetry.detail":
      return success({ resources: { cpu_millis: 250 } })
    case "templates.detail":
      return success({
        id: "tpl_1",
        name: "Orders",
        services,
        updated_at: "2026-10-01T10:00:00Z",
      })
    case "health.summary":
      return success({
        counts: { healthy: 1, unknown: 2 },
        items: [
          {
            instance: {
              id: "inst_1",
              name: "Billing",
              provider_name: "docker",
            },
            health: { status: "healthy", checks: [] },
          },
        ],
      })
    case "audit.list":
      return success({
        items: [
          {
            id: "aud_1",
            created_at: "2026-10-02T10:00:00Z",
            actor_id: "user_9",
            action: "create",
            resource: "workloads",
          },
        ],
      })
    case "events.list":
      return success({
        items: [
          {
            timestamp: "2026-10-02T10:00:00Z",
            type: "workload.created",
            tenant_id: "tnt_1",
          },
        ],
      })
    case "config.detail":
      return success({ listen_addr: ":8080", vault_configured: true })
    default:
      return success({})
  }
}

function mount(page: React.ReactNode) {
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
      const req = JSON.parse(String(init.body)) as ContractEnvelopeRequest
      return {
        ok: true,
        status: 200,
        json: async () => answer(req),
      } as Response
    })
  )
  return render(<PluginProvider client={client}>{page}</PluginProvider>)
}

describe("Ctrlplane pages follow the shared layout", () => {
  it("OverviewPage follows the shared layout", async () => {
    const { container } = mount(<OverviewPage />)
    await screen.findByText("4242")
    // The workload list and the workload health row both name it.
    await waitFor(() => expect(screen.getAllByText("Orders")).toHaveLength(2))
    await screen.findByText("2/2 healthy")
    await screen.findByText("dep_77")
    await screen.findByText("reaper")
    expect(layoutViolations(container)).toEqual([])
    for (const name of [
      "System overview",
      "Workloads",
      "Workload health",
      "Recent deployments",
      "Workers",
    ])
      expect(screen.getByRole("region", { name })).toBeTruthy()
  })

  it("ResourceList follows the shared layout for workloads", async () => {
    const { container } = mount(<ResourceList kind="workloads" />)
    await screen.findByText("Orders")
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Workload list" })).toBeTruthy()
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeTruthy()
  })

  it("ResourceList follows the shared layout for providers", async () => {
    const { container } = mount(<ResourceList kind="providers" />)
    await screen.findByText("docker")
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Provider list" })).toBeTruthy()
  })

  it("ResourceDetail follows the shared layout for an instance", async () => {
    const { container } = mount(
      <ResourceDetail kind="instances" params={{ id: "inst_1" }} />
    )
    await screen.findByText("http://orders.test")
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Details" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "Services" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "Endpoints" })).toBeTruthy()
  })

  it("ResourceDetail follows the shared layout for an instance tab", async () => {
    const { container } = mount(
      <ResourceDetail
        kind="instances"
        params={{ id: "inst_1", section: "domains" }}
      />
    )
    await screen.findByText("orders.example.test")
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Domains" })).toBeTruthy()
  })

  it("ResourceDetail follows the shared layout for instance telemetry", async () => {
    const { container } = mount(
      <ResourceDetail
        kind="instances"
        params={{ id: "inst_1", section: "telemetry" }}
      />
    )
    await screen.findByText("Only the resource snapshot", { exact: false })
    await screen.findByText("Inspect resources")
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Telemetry" })).toBeTruthy()
  })

  it("ResourceDetail follows the shared layout for a worker", async () => {
    const { container } = mount(
      <ResourceDetail kind="workers" params={{ id: "reaper" }} />
    )
    await screen.findByText("Run count")
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Details" })).toBeTruthy()
  })

  it("ResourceDetail follows the shared layout for a provider", async () => {
    const { container } = mount(
      <ResourceDetail kind="providers" params={{ id: "docker" }} />
    )
    await screen.findByText("Checked at")
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Details" })).toBeTruthy()
  })

  it("ResourceEditor follows the shared layout when creating a workload", async () => {
    const { container } = mount(<ResourceEditor kind="workloads" />)
    await screen.findByRole("button", { name: "Save" })
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Workload form" })).toBeTruthy()
  })

  it("ResourceEditor follows the shared layout when editing a template", async () => {
    const { container } = mount(
      <ResourceEditor kind="templates" params={{ id: "tpl_1" }} />
    )
    await screen.findByRole("button", { name: "Save" })
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Template form" })).toBeTruthy()
  })

  it("SelectionPage follows the shared layout", async () => {
    const { container } = mount(<SelectionPage surface="network" />)
    await screen.findByText("Billing")
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Instance list" })).toBeTruthy()
  })

  it("HealthPage follows the shared layout", async () => {
    const { container } = mount(<HealthPage />)
    await screen.findByText("2/2 healthy")
    await screen.findByText("Billing")
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Workload health" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "Instances" })).toBeTruthy()
  })

  it("LogPage follows the shared layout for the audit log", async () => {
    const { container } = mount(<LogPage kind="audit" />)
    await screen.findByText("user_9")
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Audit entries" })).toBeTruthy()
  })

  it("LogPage follows the shared layout for events", async () => {
    const { container } = mount(<LogPage kind="events" />)
    await screen.findByText("workload.created")
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Event log" })).toBeTruthy()
  })

  it("ConfigPage follows the shared layout", async () => {
    const { container } = mount(<ConfigPage />)
    await screen.findByText("Listen addr")
    expect(layoutViolations(container)).toEqual([])
    expect(screen.getByRole("region", { name: "Details" })).toBeTruthy()
  })
})
