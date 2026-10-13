import { expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import EditorPage from "../src/pages/editor"
import { PrivacyPage } from "../src/pages/privacy"
import {
  CollectionPage,
  DetailPage,
  OverviewPage,
  SettingsPage,
} from "../src/pages/read"
import { renderPage, stubClient } from "./harness"

// Every page, rendered with data the way its own test renders it, must follow
// the shared layout: one h1, every h2 and table inside a kit Section.

const caps = {
  engine: { evaluation: false, unavailable_layers: [] },
  scope: { tenant_id: "tenant", app_id: "app" },
  can_manage: true,
  can_manage_privacy: true,
  schemas: {
    boundaries: [
      { key: "limits", label: "limits", type: "tags" },
      {
        key: "response",
        label: "response",
        type: "select",
        options: ["block"],
        required: true,
      },
    ],
  },
}

const page = { items: [], total: 0, limit: 25, offset: 0, has_more: false }

const scan = {
  id: "scan_1",
  decision: "block",
  direction: "input",
  findings: [{ kind: "injection" }],
  pii_count: 1,
  duration_ms: 12,
  profile_used: "default",
  created_at: "2026-10-08T12:00:00Z",
}

const instinct = {
  id: "inst_1",
  name: "guard",
  enabled: true,
  category: "injection",
  sensitivity: "balanced",
  action: "block",
  strategies: [{ name: "classifier", weight: 0 }],
  description: "",
  metadata: { source: "example" },
  created_at: "2026-10-08T12:00:00Z",
  updated_at: "2026-10-08T12:00:00Z",
}

it("Overview follows the shared layout", async () => {
  const { container } = renderPage(
    OverviewPage,
    stubClient({
      capabilities: caps,
      overview: {
        sections: [
          { collection: "instincts", available: true, total: 3 },
          { collection: "scans", available: false },
        ],
      },
      "scans.list": { ...page, items: [scan], total: 1 },
    })
  )
  await screen.findByRole("heading", { level: 1 })
  await screen.findByRole("group", { name: "Configuration summary" })
  await screen.findByText("block")
  expect(layoutViolations(container)).toEqual([])
})

it("Collection list follows the shared layout", async () => {
  const { container } = renderPage(
    (p) => <CollectionPage {...p} collection="instincts" />,
    stubClient({
      capabilities: caps,
      "instincts.list": { ...page, items: [instinct], total: 1 },
    })
  )
  await screen.findByRole("link", { name: "guard" })
  expect(layoutViolations(container)).toEqual([])
})

it("Record detail follows the shared layout", async () => {
  const { container } = renderPage(
    (p) => <DetailPage {...p} collection="instincts" />,
    stubClient({
      capabilities: caps,
      "instincts.detail": instinct,
      "profiles.references": ["prof_a"],
    }),
    { id: "inst_1" }
  )
  await screen.findByRole("link", { name: "prof_a" })
  expect(layoutViolations(container)).toEqual([])
})

it("Policy detail follows the shared layout", async () => {
  const { container } = renderPage(
    (p) => <DetailPage {...p} collection="policies" />,
    stubClient({
      capabilities: caps,
      "policies.detail": {
        id: "pol_1",
        name: "default",
        enabled: true,
        scope_level: "app",
        rules: [{ name: "r1" }],
      },
      "policies.assignments": { tenant_id: "tenant", assigned: true },
    }),
    { id: "pol_1" }
  )
  await screen.findByRole("heading", { name: "Rules" })
  await screen.findByRole("button", { name: "Unassign" })
  expect(layoutViolations(container)).toEqual([])
})

it("Stored scan detail follows the shared layout", async () => {
  const { container } = renderPage(
    (p) => <DetailPage {...p} collection="scans" />,
    stubClient({
      capabilities: caps,
      "scans.detail": scan,
      "pii.byScan": {
        ...page,
        items: [
          {
            id: "tok_1",
            pii_type: "email",
            placeholder: "[EMAIL]",
            expires_at: "2026-10-09T12:00:00Z",
          },
        ],
        total: 1,
      },
    }),
    { id: "scan_1" }
  )
  await screen.findByText("[EMAIL]")
  expect(layoutViolations(container)).toEqual([])
})

it("Settings follows the shared layout", async () => {
  const { container } = renderPage(
    SettingsPage,
    stubClient({
      capabilities: caps,
      "config.detail": { listen: ":8080", shutdown_timeout: 5e9 },
    })
  )
  await screen.findByText(":8080")
  expect(layoutViolations(container)).toEqual([])
  expect(
    screen.getByRole("region", { name: "Effective configuration" })
  ).toBeTruthy()
})

it("PII vault follows the shared layout", async () => {
  const { container } = renderPage(
    PrivacyPage,
    stubClient({
      capabilities: caps,
      "pii.stats": {
        ...page,
        items: [
          {
            id: "token",
            pii_type: "email",
            placeholder: "[EMAIL]",
            scan_id: "scan",
          },
        ],
        total: 31,
        by_type: { email: 28, phone: 3 },
        distinct_types: 2,
      },
    })
  )
  await screen.findByText("[EMAIL]")
  expect(layoutViolations(container)).toEqual([])
})

// The editor has no h2 or table, so the guard also names the regions it
// expects: the form's field groups are sections.
it("New record editor follows the shared layout", async () => {
  const { container } = renderPage(
    (p) => <EditorPage {...p} collection="boundaries" />,
    stubClient({ capabilities: caps })
  )
  await screen.findByLabelText("Name *")
  expect(layoutViolations(container)).toEqual([])
  expect(screen.getByRole("region", { name: "Basics" })).toBeTruthy()
  expect(
    screen.getByRole("region", { name: "Configuration fields" })
  ).toBeTruthy()
  expect(screen.getByRole("region", { name: "Metadata JSON" })).toBeTruthy()
})

it("Edit record editor follows the shared layout", async () => {
  const { container } = renderPage(
    (p) => <EditorPage {...p} collection="boundaries" />,
    stubClient({
      capabilities: caps,
      "boundaries.detail": {
        id: "guard",
        name: "guard",
        enabled: true,
        description: "before",
        updated_at: "2026-10-08T12:00:00Z",
      },
    }),
    { id: "guard" }
  )
  await screen.findByLabelText("Description")
  expect(layoutViolations(container)).toEqual([])
  expect(screen.getByRole("region", { name: "Basics" })).toBeTruthy()
})
