import { expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { OverviewPage } from "../src/pages/overview"
import { QueueDetailPage, QueuesPage } from "../src/pages/queues"
import { WorkerDetailPage, WorkersPage } from "../src/pages/workers"
import {
  HandlersPage,
  JobHandlerPage,
  WorkflowHandlerPage,
} from "../src/pages/handlers"
import { EnginePage } from "../src/pages/config"
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

it("preserves small configured rates and resource measurements", async () => {
  renderWithClient(
    <EnginePage />,
    clientFor({
      "engine.config": () => ({
        ...config,
        queues: [
          {
            name: "slow",
            settings: {
              maxConcurrency: 0,
              rateLimit: 0.000125,
              rateBurst: 0,
              effectiveRateBurst: 1,
            },
          },
        ],
        resources: { ...config.resources, defaults: { cpu: 0.0000625 } },
      }),
    })
  )
  await screen.findByText("0.000125")
  expect(screen.getByText("0.0000625")).toBeTruthy()
})

it("labels an uncapped declared artifact input without implying a zero-byte limit", async () => {
  renderWithClient(
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
          resources: {},
          resourceLimits: {},
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
  expect(screen.getByText("source")).toBeTruthy()
})

it("links authoritative overview counts without inferring health", async () => {
  renderWithClient(
    <OverviewPage />,
    clientFor({ "overview.summary": () => overview })
  )
  await screen.findByRole("heading", { name: "Operations" })
  expect(
    screen
      .getAllByRole("link", { name: "failed 1" })
      .map((link) => link.getAttribute("href"))
  ).toContain("/jobs?states=failed")
  expect(
    screen.getByRole("link", { name: "3 unreplayed" }).getAttribute("href")
  ).toBe("/dlq")
  expect(screen.queryByText(/healthy/i)).toBeNull()
  expect(screen.getByText(/Counts come from the store/)).toBeTruthy()
})
it("labels unknown queue measurements and encodes queue paths", async () => {
  renderWithClient(
    <QueuesPage />,
    clientFor({
      "queues.list": () => ({
        ...page([queue]),
        workerDiscoveryEnabled: false,
      }),
    })
  )
  const link = await screen.findByRole("link", { name: queue.name })
  expect(link.getAttribute("href")).toBe("/queues/email%2Fbulk")
  expect(screen.getByLabelText("no local active count")).toBeTruthy()
  expect(screen.getByText(/Historical queue names/)).toBeTruthy()
})
it("reads queue jobs with an explicit queue filter and follows incomplete cursor portions", async () => {
  const read = vi.fn((params: unknown) =>
    (params as { cursor: string }).cursor
      ? page([job])
      : { ...page([]), complete: false, nextCursor: "resume" }
  )
  renderWithClient(
    <QueueDetailPage params={{ name: queue.name }} />,
    clientFor({ "queues.get": () => ({ ...queue, asOf }), "jobs.list": read })
  )
  await screen.findByText("No results in this portion")
  fireEvent.click(screen.getByRole("button", { name: "Continue search" }))
  await screen.findByRole("link", { name: job.id })
  expect(read).toHaveBeenLastCalledWith({
    queue: queue.name,
    cursor: "resume",
    limit: 25,
  })
})
it("distinguishes an absent worker registry from an empty registry", async () => {
  renderWithClient(
    <WorkersPage />,
    clientFor({
      "workers.list": () => ({
        ...page([]),
        enabled: false,
        leaderId: null,
        heartbeatReference: null,
        silentAfter: null,
      }),
    })
  )
  await screen.findByText("Worker registry not configured")
  expect(
    screen
      .getByRole("link", { name: "Inspect engine settings" })
      .getAttribute("href")
  ).toBe("/config")
  expect(screen.queryByRole("table")).toBeNull()
})
it("shows recorded worker heartbeat and leadership without local lease claims", async () => {
  renderWithClient(
    <WorkerDetailPage params={{ id: worker.id }} />,
    clientFor({ "workers.get": () => workerDetail })
  )
  await screen.findByText("Recent heartbeat")
  expect(screen.getByText("Leader")).toBeTruthy()
  expect(screen.getByText("Not recorded for remote workers")).toBeTruthy()
  expect(
    screen.getByText(/only for the process serving this page/)
  ).toBeTruthy()
  expect(screen.queryByRole("heading", { name: "Local capacity" })).toBeNull()
})
it("shows local resource leases when measured by the serving worker", async () => {
  renderWithClient(
    <WorkerDetailPage params={{ id: worker.id }} />,
    clientFor({
      "workers.get": () => ({
        ...workerDetail,
        worker: { ...worker, self: true, heartbeatInterval: duration },
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
  expect(screen.getByRole("heading", { name: "Free" })).toBeTruthy()
  expect(screen.getByRole("heading", { name: "Reclaimable" })).toBeTruthy()
})
it("lists all workflow versions with an encoded handler link", async () => {
  renderWithClient(
    <HandlersPage />,
    clientFor({ "handlers.list": () => page([handler]) })
  )
  const link = await screen.findByRole("link", { name: handler.name })
  expect(link.getAttribute("href")).toBe(
    "/handlers/workflows/image%2Fnormalize"
  )
  expect(screen.getByText("1, 4")).toBeTruthy()
})
it("queries a workflow definition with its exact kind and name", async () => {
  const read = vi.fn(() => handler)
  renderWithClient(
    <WorkflowHandlerPage params={{ name: handler.name }} />,
    clientFor({ "handlers.get": read })
  )
  await screen.findByText("1, 4")
  expect(read).toHaveBeenCalledWith({ kind: "workflow", name: handler.name })
  expect(
    screen
      .getByRole("link", { name: "Browse matching runs" })
      .getAttribute("href")
  ).toBe("/workflows?namePrefix=image%2Fnormalize")
})
it("shows process settings and qualifies requested execution limits", async () => {
  renderWithClient(<EnginePage />, clientFor({ "engine.config": () => config }))
  await screen.findByRole("heading", { name: "Pool and polling" })
  expect(screen.getByText(/do not prove enforcement/)).toBeTruthy()
  expect(screen.getByRole("heading", { name: "Artifacts" })).toBeTruthy()
  expect(screen.getByText("Not supported")).toBeTruthy()
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
})
