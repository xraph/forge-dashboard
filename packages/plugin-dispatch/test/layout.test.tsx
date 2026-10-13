import { expect, it } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import { OverviewPage } from "../src/pages/overview"
import { QueueDetailPage, QueuesPage } from "../src/pages/queues"
import { WorkerDetailPage, WorkersPage } from "../src/pages/workers"
import {
  HandlersPage,
  JobHandlerPage,
  WorkflowHandlerPage,
} from "../src/pages/handlers"
import { EnginePage } from "../src/pages/config"
import { DurableExecutionsPage } from "../src/pages/durable-executions"
import { DurableExecutionPage } from "../src/pages/durable-execution"
import { encodeRunPart } from "../src/durable-types"
import { clientFor, renderWithClient } from "./harness"
import {
  asOf,
  config,
  duration,
  handler,
  job,
  overview,
  page,
  queue,
  worker,
  workerDetail,
} from "./operational-fixtures"
import wire from "./durable-wire.json"

const detailProps = {
  params: {
    namespace: encodeRunPart("production"),
    workflow: encodeRunPart("invoice-42"),
    run: encodeRunPart("run-2"),
  },
}
const durableQueries = {
  "durable.execution": () => wire.detail.data,
  "durable.history": () => wire.history.data,
  "durable.tasks": () => wire.tasks.data,
  "durable.chain": () => wire.chain_partial.data,
  "durable.children": () => wire.children_restricted.data,
  "durable.audit": () => wire.deliveries_blocked.data,
  "durable.hooks": () => wire.deliveries_blocked.data,
  "durable.payload": () => wire.payload_reveal.data,
}

it("Overview follows the shared layout", async () => {
  const { container } = renderWithClient(
    <OverviewPage />,
    clientFor({ "overview.summary": () => overview })
  )
  await screen.findByRole("heading", { name: "Operations" })
  expect(layoutViolations(container)).toEqual([])
})
it("Overview counters link to their job and workflow states", async () => {
  renderWithClient(
    <OverviewPage />,
    clientFor({ "overview.summary": () => overview })
  )
  await screen.findByRole("heading", { name: "Operations" })
  const href = (name: string) =>
    screen
      .getAllByRole("link")
      .find((link) => link.textContent === name)
      ?.getAttribute("href")
  expect(href("failed1")).toBe("/jobs?states=failed")
  expect(href("pending4")).toBe("/jobs?states=pending")
  expect(href("running2")).toBe("/jobs?states=running")
  expect(href("completed18")).toBe("/jobs?states=completed")
  expect(href("completed8")).toBe("/workflows?state=completed")
  const failed = screen
    .getAllByRole("link", { name: /^failed/ })
    .map((link) => link.getAttribute("href"))
  expect(failed).toEqual(["/jobs?states=failed", "/workflows?state=failed"])
})
it("Engine follows the shared layout", async () => {
  const { container } = renderWithClient(
    <EnginePage />,
    clientFor({ "engine.config": () => config })
  )
  await screen.findByRole("heading", { name: "Pool and polling" })
  expect(layoutViolations(container)).toEqual([])
})
it("Handlers follows the shared layout", async () => {
  const { container } = renderWithClient(
    <HandlersPage />,
    clientFor({ "handlers.list": () => page([handler]) })
  )
  await screen.findByRole("link", { name: handler.name })
  expect(layoutViolations(container)).toEqual([])
})
it("Job handler follows the shared layout", async () => {
  const { container } = renderWithClient(
    <JobHandlerPage params={{ name: "convert" }} />,
    clientFor({
      "handlers.get": () => ({
        ...handler,
        kind: "job",
        name: "convert",
        versions: [],
        job: {
          inputs: [
            { name: "source", required: true, mode: "stream", maxSize: 0 },
          ],
          resources: { cpu: 1 },
          resourceLimits: { cpu: 2 },
          resourceClass: null,
          resourceFunction: false,
          leaseTtl: null,
          effectiveLeaseTtl: duration,
          execution: {
            level: "function",
            gracePeriod: duration,
            allowDowngrade: false,
            image: null,
          },
        },
      }),
    })
  )
  await screen.findByText("No limit")
  expect(layoutViolations(container)).toEqual([])
})
it("Workflow handler follows the shared layout", async () => {
  const { container } = renderWithClient(
    <WorkflowHandlerPage params={{ name: handler.name }} />,
    clientFor({ "handlers.get": () => handler })
  )
  await screen.findByText("1, 4")
  expect(layoutViolations(container)).toEqual([])
})
it("Queues follows the shared layout", async () => {
  const { container } = renderWithClient(
    <QueuesPage />,
    clientFor({
      "queues.list": () => ({
        ...page([queue]),
        workerDiscoveryEnabled: false,
      }),
    })
  )
  await screen.findByRole("link", { name: queue.name })
  expect(layoutViolations(container)).toEqual([])
})
it("Queue detail follows the shared layout", async () => {
  const { container } = renderWithClient(
    <QueueDetailPage params={{ name: queue.name }} />,
    clientFor({
      "queues.get": () => ({ ...queue, asOf }),
      "jobs.list": () => ({ ...page([job]), nextCursor: "more" }),
    })
  )
  await screen.findByRole("link", { name: job.id })
  expect(layoutViolations(container)).toEqual([])
})
it("Workers follows the shared layout", async () => {
  const { container } = renderWithClient(
    <WorkersPage />,
    clientFor({
      "workers.list": () => ({
        ...page([worker]),
        enabled: true,
        leaderId: worker.id,
        heartbeatReference: null,
        silentAfter: duration,
      }),
    })
  )
  await screen.findByRole("link", { name: worker.id })
  expect(layoutViolations(container)).toEqual([])
})
it("Worker detail follows the shared layout", async () => {
  const { container } = renderWithClient(
    <WorkerDetailPage params={{ id: worker.id }} />,
    clientFor({
      "workers.get": () => ({
        ...workerDetail,
        worker: { ...worker, self: true },
        resources: {
          enabled: true,
          capacity: { cpu: 4 },
          free: { cpu: 2 },
          reclaimable: { cpu: 1 },
          leases: [{ owner: "job-owner", held: { cpu: 2 }, acquiredAt: asOf }],
        },
      }),
    })
  )
  await screen.findByText("job-owner")
  expect(layoutViolations(container)).toEqual([])
})
it("Durable executions follows the shared layout", async () => {
  const { container } = renderWithClient(
    <DurableExecutionsPage />,
    clientFor({
      "durable.namespaces": () => wire.discovery_complete.data,
      "durable.executions": () => ({
        ...wire.executions.data,
        cursor: "next",
        complete: false,
      }),
    })
  )
  fireEvent.click(await screen.findByRole("button", { name: "production" }))
  await screen.findByText(/9007199254740993/)
  expect(layoutViolations(container)).toEqual([])
})
it("Durable execution follows the shared layout", async () => {
  const { container } = renderWithClient(
    <DurableExecutionPage {...detailProps} />,
    clientFor(durableQueries)
  )
  await screen.findByText("9007199254740995")
  expect(layoutViolations(container)).toEqual([])
})
it("Durable execution tabs and revealed payload follow the shared layout", async () => {
  const { container } = renderWithClient(
    <DurableExecutionPage {...detailProps} />,
    clientFor(durableQueries)
  )
  await screen.findByText("9007199254740995")
  fireEvent.click(screen.getByRole("button", { name: "Reveal payload" }))
  await screen.findByText(/Revealed at revision/)
  expect(layoutViolations(container)).toEqual([])
  fireEvent.click(screen.getByRole("button", { name: "Tasks" }))
  await screen.findByText(/activity:payment/)
  expect(layoutViolations(container)).toEqual([])
  fireEvent.click(screen.getByRole("button", { name: "Run chain" }))
  await screen.findAllByRole("link", { name: /invoice-42/ })
  expect(layoutViolations(container)).toEqual([])
  fireEvent.click(screen.getByRole("button", { name: "Hook delivery" }))
  await screen.findByText(/Webhook endpoint delivery: unavailable/)
  expect(layoutViolations(container)).toEqual([])
})
it("Invalid execution link follows the shared layout", () => {
  const { container } = renderWithClient(
    <DurableExecutionPage
      params={{ namespace: "!", workflow: "!", run: "!" }}
    />,
    clientFor({})
  )
  expect(layoutViolations(container)).toEqual([])
})
