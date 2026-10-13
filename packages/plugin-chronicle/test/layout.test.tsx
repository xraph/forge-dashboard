import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { afterEach, describe, expect, it } from "vitest"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import { ActivityPage } from "../src/pages/activity"
import { ArchivesPage } from "../src/pages/archives"
import { ChainPage } from "../src/pages/chain"
import { CheckpointDetailPage } from "../src/pages/checkpoint-detail"
import { CheckpointsPage } from "../src/pages/checkpoints"
import { CustomReportCreatePage } from "../src/pages/custom-report-create"
import { ErasureDetailPage } from "../src/pages/erasure-detail"
import { ErasuresPage } from "../src/pages/erasures"
import { EventDetailPage } from "../src/pages/event-detail"
import { EventsPage } from "../src/pages/events"
import { PolicyCreatePage } from "../src/pages/policy-create"
import { PolicyDetailPage } from "../src/pages/policy-detail"
import { ReportCreatePage } from "../src/pages/report-create"
import { ReportDetailPage } from "../src/pages/report-detail"
import { ReportsPage } from "../src/pages/reports"
import { RetentionPage } from "../src/pages/retention"
import { SettingsPage } from "../src/pages/settings"
import { UserEventsPage } from "../src/pages/user-events"
import { renderPage, scriptedClient } from "./harness"
import { broken } from "./verification/fixtures"
import type {
  ArchiveSummary,
  CheckpointSummary,
  ErasureSummary,
  EventDetail,
  EventSummary,
  PolicySummary,
  ReportDetail,
  ReportSummary,
  SettingsDetail,
  StreamSummary,
} from "../src/types"

afterEach(cleanup)

/**
 * The guard plus the panels the page is meant to be built from. The guard
 * alone passes a page with no h2 and no table, so the regions say that its
 * blocks are sections and not loose markup.
 */
function expectLayout(container: HTMLElement, ...regions: string[]) {
  expect(layoutViolations(container)).toEqual([])
  for (const name of regions)
    expect(screen.getByRole("region", { name })).toBeTruthy()
}

const stream: StreamSummary = {
  id: "stream_acme",
  appId: "app_chronicle",
  tenantId: "acme",
  headHash: "ab",
  headSeq: 61004,
  scheme: "chronicle/v5",
  schemeSince: 48201,
  coverageCeiling: "signed",
  checkpointingConfigured: true,
}

const checkpoint = (n: number): CheckpointSummary => ({
  id: `ckpt_acme_${n}`,
  fromSeq: (n - 1) * 10000 + 1,
  toSeq: n * 10000,
  eventCount: 10000,
  createdAt: "2026-09-29T10:00:00Z",
  signKeyId: "sk_2026_09",
})

const event = (seq: number): EventSummary => ({
  id: `audit_own_${seq}`,
  timestamp: "2026-09-29T11:00:00Z",
  sequence: seq,
  action: "user.login",
  resource: "session",
  category: "auth",
  outcome: "success",
  severity: "info",
  userId: "user_1",
  ip: "10.0.0.1",
  erased: false,
})

const erasure: ErasureSummary = {
  id: "erasure_3",
  subjectId: "subject_1",
  reason: "GDPR Article 17 request 5520",
  requestedBy: "user_admin",
  eventsAffected: 12431,
  keyDestroyed: true,
  legacyKeyRetained: false,
  status: "completed",
  createdAt: "2026-09-29T10:00:00Z",
}

const policy: PolicySummary = {
  id: "retpol_acme_debug",
  category: "debug",
  duration: "720h0m0s",
  archive: false,
  appId: "app_chronicle",
  tenantId: "acme",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-02T00:00:00Z",
  editable: true,
}

const archive: ArchiveSummary = {
  id: "archive_1",
  policyId: "retpol_acme_debug",
  category: "debug",
  eventCount: 5000,
  fromTimestamp: "2026-06-01T00:00:00Z",
  toTimestamp: "2026-06-30T00:00:00Z",
  sinkName: "s3",
  sinkRef: "s3://audit-archive/acme/1.jsonl.gz",
  tenantId: "acme",
  createdAt: "2026-09-29T10:00:00Z",
}

const summary: ReportSummary = {
  id: "report_1",
  title: "SOC 2 evidence 1",
  type: "soc2",
  period: { from: "2026-07-01T00:00:00Z", to: "2026-09-30T00:00:00Z" },
  generatedBy: "user_admin",
  format: "json",
  createdAt: "2026-09-29T10:00:00Z",
}

const report: ReportDetail = {
  ...summary,
  title: "SOC 2 evidence, Q3",
  stats: {
    totalEvents: 12431,
    criticalEvents: 7,
    failedEvents: 42,
    deniedEvents: 3,
  },
  sections: [
    {
      title: "Access control",
      notes: "Logical access to systems.",
      events: [event(1), event(2)],
      matchedEvents: 40,
      eventsTruncated: true,
    },
    {
      title: "Change management",
      events: [],
      matchedEvents: 0,
      eventsTruncated: false,
    },
  ],
  verification: broken,
  verificationScope: {
    status: "verified",
    streamId: "stream_acme",
    headSeq: 5000,
    fromSeq: 101,
    toSeq: 5000,
    window: 4900,
    capped: true,
    checkpointsConfigured: true,
    notes: ["Tenant chains were not checked."],
  },
}

const eventDetail: EventDetail = {
  ...event(2780),
  id: "audit_globex_2780",
  resourceId: "pr_88",
  streamId: "stream_globex",
  hash: "aa".repeat(32),
  prevHash: "bb".repeat(32),
  hashScheme: "chronicle/v5",
  hashKeyId: "hk_1",
  reason: "chart correction",
  subjectId: "subject_1",
  requestId: "req_2780",
  sessionId: "sess_8",
  metadata: { requestPath: "/api/records/pr_88" },
}

const settings: SettingsDetail = {
  batchSize: 100,
  flushInterval: "1s",
  retentionInterval: "24h0m0s",
  enableCryptoErasure: false,
  digestScheme: "chronicle/v4",
  keyed: false,
  checkpointingConfigured: false,
  backendName: "sqlite",
  backendHoldsCheckpoints: true,
}

describe("Chronicle pages follow the shared layout", () => {
  it("Activity follows the shared layout", async () => {
    const { client } = scriptedClient({
      "overview.stats": {
        totalEvents: 12431,
        criticalEvents: 21,
        failedEvents: 40,
        deniedEvents: 12,
        erasureCount: 2,
        categories: [{ category: "auth", count: 12431 }],
        severities: [{ severity: "info", count: 12431 }],
        outcomes: [{ outcome: "success", count: 12431 }],
      },
      "events.aggregate": {
        groups: [{ bucket: "2026-09-28", count: 6 }],
        total: 6,
      },
    })
    const { container } = renderPage(ActivityPage, client)
    await screen.findByText("Total events")
    await screen.findByRole("img", { name: /Events per day/ })
    expectLayout(
      container,
      "By category",
      "By severity",
      "By outcome",
      "Volume over time"
    )
  })

  it("Archives follows the shared layout", async () => {
    const { client } = scriptedClient({
      "retention.archives": { archives: [archive], hasMore: true },
    })
    const { container } = renderPage(ArchivesPage, client)
    await screen.findByText("archive_1")
    expectLayout(container, "Archive list")
  })

  it("Chain follows the shared layout", async () => {
    const { client } = scriptedClient({
      "streams.mine": { stream },
      "streams.list": { streams: [stream], total: 1, hasMore: false },
      "verify.run": { noChain: false, report: broken },
    })
    const { container } = renderPage(ChainPage, client, {
      streamId: "stream_acme",
      fromSeq: "2730",
      toSeq: "2830",
    })
    await screen.findByText(/Breaks found/)
    await screen.findByText("What was found")
    expectLayout(container, "Posture", "Check a range", "Verification result")
  })

  it("Chain without an own chain follows the shared layout", async () => {
    const { client } = scriptedClient({
      "streams.mine": {},
      "streams.list": { streams: [stream], total: 1, hasMore: false },
    })
    const { container } = renderPage(ChainPage, client)
    await screen.findByText(/This app has no app-level chain/)
    expectLayout(container, "Chain choice")
  })

  it("Checkpoint detail follows the shared layout", async () => {
    const { client } = scriptedClient({
      "checkpoints.detail": { checkpoint: checkpoint(6) },
      "streams.list": { streams: [stream], total: 1, hasMore: false },
    })
    const { container } = renderPage(CheckpointDetailPage, client, {
      id: "ckpt_acme_6",
    })
    await screen.findByText("sk_2026_09")
    await screen.findByRole("link", { name: /Verify sequences/ })
    expectLayout(container, "Details")
  })

  it("Checkpoints follows the shared layout", async () => {
    const { client } = scriptedClient({
      "streams.mine": { stream },
      "streams.list": { streams: [stream], total: 1, hasMore: false },
      "checkpoints.list": {
        checkpoints: [checkpoint(6), checkpoint(5)],
        hasMore: true,
        supported: true,
      },
    })
    const { container } = renderPage(CheckpointsPage, client)
    await screen.findByText("ckpt_acme_6")
    expectLayout(container, "Checkpoint list")
  })

  it("Custom report create follows the shared layout", async () => {
    const { client } = scriptedClient({})
    const { container } = renderPage(CustomReportCreatePage, client)
    await screen.findByLabelText("Title")
    fireEvent.click(screen.getByRole("button", { name: "Add section" }))
    await screen.findByLabelText("Section 2 title")
    expectLayout(
      container,
      "Report details",
      "Section 1",
      "Section 2",
      "Add sections and generate"
    )
  })

  it("Erasure detail follows the shared layout", async () => {
    const { client } = scriptedClient({ "erasures.detail": erasure })
    const { container } = renderPage(ErasureDetailPage, client, {
      id: "erasure_3",
    })
    await screen.findByText("subject_1")
    expectLayout(container, "Details")
  })

  it("Erasures follows the shared layout", async () => {
    const { client } = scriptedClient({
      "erasures.list": { erasures: [erasure], total: 1, hasMore: false },
    })
    const { container } = renderPage(ErasuresPage, client)
    await screen.findByText("subject_1")
    expectLayout(container, "Erasure list")
  })

  it("Event detail follows the shared layout", async () => {
    const { client } = scriptedClient({
      "events.detail": eventDetail,
      "streams.mine": { stream: { ...stream, id: "stream_globex" } },
    })
    const { container } = renderPage(EventDetailPage, client, {
      id: "audit_globex_2780",
    })
    await screen.findByText("2,780")
    await screen.findByLabelText("metadata")
    await screen.findByRole("link", {
      name: "Check the chain around this event",
    })
    expectLayout(
      container,
      "Details",
      "Metadata",
      "Chain position",
      "Digest check"
    )
  })

  it("Events follows the shared layout", async () => {
    const { client } = scriptedClient({
      "events.list": { events: [event(12431)], total: 120, hasMore: true },
    })
    const { container } = renderPage(EventsPage, client)
    await screen.findByText("12,431")
    expectLayout(container, "Filters", "Event list")
  })

  it("Policy create follows the shared layout", async () => {
    const { client } = scriptedClient({})
    const { container } = renderPage(PolicyCreatePage, client)
    await screen.findByLabelText("Category")
    expectLayout(container, "New policy")
  })

  it("Policy detail follows the shared layout", async () => {
    const { client } = scriptedClient({ "retention.policyDetail": policy })
    const { container } = renderPage(PolicyDetailPage, client, {
      id: "retpol_acme_debug",
    })
    await screen.findByRole("button", { name: "Save changes" })
    await screen.findByRole("button", { name: "Delete policy" })
    expectLayout(container, "Details", "Edit policy", "Danger zone")
  })

  it("Report create follows the shared layout", async () => {
    const { client } = scriptedClient({})
    const { container } = renderPage(ReportCreatePage, client)
    await screen.findByLabelText("Report type")
    expectLayout(container, "New report")
  })

  it("Report detail follows the shared layout", async () => {
    const { client } = scriptedClient({ "reports.detail": report })
    const { container } = renderPage(ReportDetailPage, client, {
      id: "report_1",
    })
    await screen.findByText("12,431")
    await screen.findByText("Change management")
    await screen.findByText("What was found")
    expectLayout(
      container,
      "Details",
      "Access control",
      "Change management",
      "Integrity"
    )
  })

  it("Reports follows the shared layout", async () => {
    const { client } = scriptedClient({
      "reports.list": { reports: [summary], hasMore: true },
    })
    const { container } = renderPage(ReportsPage, client)
    await screen.findByText("SOC 2 evidence 1")
    expectLayout(container, "Report list")
  })

  it("Retention follows the shared layout", async () => {
    const { client } = scriptedClient({
      "retention.policies": { policies: [policy], total: 1 },
    })
    const { container } = renderPage(RetentionPage, client)
    await screen.findByText("Tenant acme")
    expectLayout(container, "Policy list")
  })

  it("Settings follows the shared layout", async () => {
    const { client } = scriptedClient({ "settings.detail": settings })
    const { container } = renderPage(SettingsPage, client)
    await screen.findByText("chronicle/v4")
    expectLayout(container, "Details")
  })

  it("User events follows the shared layout", async () => {
    const { client } = scriptedClient({
      "events.byUser": { events: [event(7)], total: 31, hasMore: true },
    })
    const { container } = renderPage(UserEventsPage, client, {
      userId: "user_1",
    })
    await waitFor(() => expect(screen.getByText("1 of 31 events")).toBeTruthy())
    expectLayout(container, "Event list")
  })

  it("Policy detail without edit rights follows the shared layout", async () => {
    const { client } = scriptedClient({
      "retention.policyDetail": {
        ...policy,
        editable: false,
        tenantId: undefined,
      },
    })
    const { container } = renderPage(PolicyDetailPage, client, {
      id: "retpol_acme_debug",
    })
    await screen.findByText(/This policy is set at the app level/)
    expect(screen.queryByRole("region", { name: "Edit policy" })).toBeNull()
    expect(screen.queryByRole("region", { name: "Danger zone" })).toBeNull()
    expectLayout(container, "Details")
  })

  it("Event detail of an erased event follows the shared layout", async () => {
    const { client } = scriptedClient({
      "events.detail": {
        ...eventDetail,
        erased: true,
        erasureId: "erasure_1",
        erasedAt: "2026-09-29T09:00:00Z",
        metadata: undefined,
      },
      "streams.mine": { stream: { ...stream, id: "stream_globex" } },
    })
    const { container } = renderPage(EventDetailPage, client, {
      id: "audit_globex_2780",
    })
    await screen.findByText(/Erased by/)
    await screen.findByText(
      /Erased with the rest of this event's sealed fields/
    )
    expectLayout(container, "Details", "Metadata", "Chain position")
  })

  it("Chain with a failed verification follows the shared layout", async () => {
    const { client } = scriptedClient({
      "streams.mine": { stream },
      "streams.list": { streams: [stream], total: 1, hasMore: false },
      "verify.run": new ContractError("BAD_REQUEST", "range too large"),
    })
    const { container } = renderPage(ChainPage, client, {
      streamId: "stream_acme",
      fromSeq: "1",
      toSeq: "50",
    })
    await screen.findByText(/The chain could not be checked/)
    expectLayout(container, "Posture", "Check a range", "Verification result")
  })
})
