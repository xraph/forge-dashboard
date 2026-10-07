import { describe, expect, it, vi } from "vitest"
import { screen, within } from "@testing-library/react"
import { KeyDetailPage } from "../src/pages/key-detail"
import type { KeyDetail, RotationsList, Settings, UsageSeries } from "../src/types"
import { renderPage, stubClient } from "./harness"

// The chart's chunk fails to load, as it does when a deploy has replaced the
// chunk the page was built against. Its own file, because React.lazy keeps
// the first answer it gets for the life of the module: a rejection here
// would leave key-detail.test.tsx's chart test unable to draw, and its chart
// would leave this one nothing to reject.
vi.mock("../src/components/usage-chart", () =>
  Promise.reject(new Error("Failed to fetch dynamically imported module")),
)

const DETAIL: KeyDetail = {
  key: {
    id: "akey_billing",
    name: "Billing service",
    prefix: "sk",
    hint: "a3f8",
    environment: "live",
    state: "active",
    effectiveState: "active",
    expiryPending: false,
    expiresSoon: false,
    scopes: [],
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-09-25T10:00:00Z",
  },
  policy: null,
  metadata: {},
  previousKeys: [],
}

const RECORDED: UsageSeries = {
  period: "daily",
  buckets: [
    "2026-09-29T00:00:00Z",
    "2026-09-30T00:00:00Z",
    "2026-10-01T00:00:00Z",
    "2026-10-02T00:00:00Z",
    "2026-10-03T00:00:00Z",
    "2026-10-04T00:00:00Z",
    "2026-10-05T00:00:00Z",
  ].map((start) => ({
    start,
    requests: 10,
    clientErrors: 1,
    serverErrors: 0,
    succeeded: 9,
    avgLatencyMs: 12,
  })),
  recorded: true,
}

const NO_ROTATIONS: RotationsList = { items: [], hasMore: false }

const SETTINGS: Settings = {
  plugins: [],
  storeHealthy: true,
  storeMessage: "The store answered.",
  rateLimiterConfigured: false,
  tenantSource: "config",
  tenant: "acme",
  enforcement: [],
  enforcedFields: 3,
  defaultGraceSeconds: 86400,
}

function section(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { level: 2, name })
  const el = heading.closest("section")
  if (!el) throw new Error(`no section for ${name}`)
  return el
}

describe("KeyDetailPage usage when the chart cannot load", () => {
  it("says the chart is unavailable, links to Usage, and keeps the count and the page", async () => {
    renderPage(
      KeyDetailPage,
      stubClient({
        "keys.detail": DETAIL,
        "rotations.list": NO_ROTATIONS,
        "usage.series": RECORDED,
        settings: SETTINGS,
      }),
      { id: "akey_billing" },
    )
    await screen.findByRole("heading", { level: 1, name: "Billing service" })
    const s = section("Usage")

    const line = await within(s).findByText(/^Chart unavailable\./)
    const link = within(line).getByRole("link")
    // This key's usage, absolute like the section's own Open usage link.
    expect(link.getAttribute("href")).toBe("/@keysmith/usage?keyId=akey_billing")

    expect(within(s).queryByRole("status", { name: "Loading the usage chart" })).toBeNull()
    expect(s.querySelector("[data-chart]")).toBeNull()
    expect(
      within(s).getByText("70 requests over 7 UTC days, today included."),
    ).toBeTruthy()
    // The rest of the page is untouched.
    expect(screen.getByRole("heading", { level: 2, name: "Validity" })).toBeTruthy()
  })
})
