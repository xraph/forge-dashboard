import { beforeEach, describe, expect, it } from "vitest"

// The fixture is plain .mjs with no types, and it is a dev tool rather than a
// shipped module, so the import below carries no declaration and is cast.

class FixtureError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

// Rows are read and written by field name, as the fixture itself does.
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
type Handler = { handler: (input: Record<string, unknown>) => Row }
type Fixture = {
  createLedgerHandlers: (e: typeof FixtureError) => Record<string, Handler>
  resetLedger: () => void
  ledgerState: () => { plans: Row[]; subscriptions: Row[]; invoices: Row[] }
}

let fixture: Fixture
let handlers: Record<string, Handler>

beforeEach(async () => {
  // @ts-expect-error TS7016: ledger-fixtures.mjs has no declaration file.
  fixture = (await import("../../fixture-server/ledger-fixtures.mjs")) as Fixture
  fixture.resetLedger()
  handlers = fixture.createLedgerHandlers(FixtureError)
})

/** A yearly subscription created on 29 February 2024, in its fourth period. */
function leapYearly() {
  const state = fixture.ledgerState()
  const base = state.plans.find((p) => p.id === "plan_pro") ?? state.plans[0]
  const plan = { ...base, id: "plan_leap", slug: "leap", pricing: { ...base.pricing, billing_period: "yearly" } }
  state.plans.push(plan)
  const sub = {
    ...state.subscriptions[0],
    id: "sub_leap",
    tenant_id: "leap-tenant",
    plan_id: plan.id,
    status: "active",
    created_at: "2024-02-29T10:00:00Z",
    current_period_start: "2026-02-28T10:00:00Z",
    current_period_end: "2027-02-28T10:00:00Z",
  }
  state.subscriptions.push(sub)
  return sub
}

function generate(start: string, end: string) {
  return handlers["invoices.generate"].handler({ subscription_id: "sub_leap", period_start: start, period_end: end })
}

describe("the fixture's named-period rule for a yearly plan created on 29 February", () => {
  it("accepts the real first period, 29 February 2024 to 28 February 2025", () => {
    leapYearly()
    const inv = generate("2024-02-29T10:00:00Z", "2025-02-28T10:00:00Z")
    expect(inv.period_start).toBe("2024-02-29T10:00:00Z")
    expect(inv.period_end).toBe("2025-02-28T10:00:00Z")
  })

  it("refuses the phantom period, 28 February 2024 to 28 February 2025, with the engine's text", () => {
    leapYearly()
    expect(() => generate("2024-02-28T10:00:00Z", "2025-02-28T10:00:00Z")).toThrow(
      "ledger: invalid input: subscription sub_leap had no billing period from 2024-02-28T10:00:00Z to 2025-02-28T10:00:00Z",
    )
  })

  it("accepts the later years, which start on the 28th", () => {
    leapYearly()
    const inv = generate("2025-02-28T10:00:00Z", "2026-02-28T10:00:00Z")
    expect(inv.period_start).toBe("2025-02-28T10:00:00Z")
  })

  it("does not widen the rule to a monthly plan, whose anchor the period itself recovers", () => {
    const sub = leapYearly()
    const state = fixture.ledgerState()
    state.plans.find((p) => p.id === "plan_leap")!.pricing.billing_period = "monthly"
    sub.created_at = "2026-01-31T10:00:00Z"
    sub.current_period_start = "2026-03-31T10:00:00Z"
    sub.current_period_end = "2026-04-30T10:00:00Z"
    expect(generate("2026-02-28T10:00:00Z", "2026-03-31T10:00:00Z").period_end).toBe("2026-03-31T10:00:00Z")
  })
})

describe("the fixture's lifecycle clock", () => {
  it("reports itself off, because nothing here runs one", () => {
    expect(handlers["settings.detail"].handler({}).lifecycle_interval).toBe("off")
  })
})
