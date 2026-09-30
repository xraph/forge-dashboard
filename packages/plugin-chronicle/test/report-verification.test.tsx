import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ReportVerification } from "../src/components/report-verification"
import type { ReportDetail, VerificationScope } from "../src/types"
import { mixed, plainNoCheckpoints, report } from "./verification/fixtures"

const base: ReportDetail = {
  id: "report_soc2", title: "SOC 2 evidence, Q3", type: "soc2", period: { from: "2026-07-01T00:00:00Z", to: "2026-09-30T00:00:00Z" },
  generatedBy: "user_admin", format: "json", createdAt: "2026-09-29T10:00:00Z", sections: [],
}

const scope = (over: Partial<VerificationScope> = {}): VerificationScope => ({
  status: "verified", streamId: "stream_acme", headSeq: 61004, fromSeq: 1, toSeq: 61004, window: 50000, capped: false, checkpointsConfigured: true, notes: [], ...over,
})

describe("ReportVerification", () => {
  it("says a report with neither field contains no integrity verification", () => {
    render(<ReportVerification report={base} />)
    expect(screen.getByRole("heading", { name: "Integrity" })).toBeTruthy()
    expect(screen.getByText("This report contains no integrity verification.")).toBeTruthy()
  })

  it("says why none ran when the scope had no chain", () => {
    render(<ReportVerification report={{ ...base, verificationScope: scope({ status: "no_chain", headSeq: 0, fromSeq: 0, toSeq: 0 }) }} />)
    expect(screen.getByText(/No verification ran: this scope has no hash chain of its own, so there was nothing to check\. A report with no tenant checks only the app-level chain, not its tenants' chains\./)).toBeTruthy()
    expect(screen.queryByText(/No alteration detected|No corruption detected/)).toBeNull()
  })

  it("says why none ran when the deployment gave the engine no chain", () => {
    render(<ReportVerification report={{ ...base, verificationScope: scope({ status: "not_configured", headSeq: 0, fromSeq: 0, toSeq: 0, checkpointsConfigured: false }) }} />)
    expect(screen.getByText(/No verification ran: this deployment gives the report engine no hash chain/)).toBeTruthy()
  })

  it("puts a capped window's limit next to its verdict and renders the engine's notes", () => {
    render(
      <ReportVerification
        report={{
          ...base,
          verification: { ...mixed, firstEvent: 11005, partial: true, retentionPolicies: -1 },
          verificationScope: scope({ streamId: "stream_acme", scheme: "chronicle/v5", schemeSince: 48201, fromSeq: 11005, capped: true, notes: ["Sequences 1 to 11004 were not verified: the report verifies at most 50,000 sequences."] }),
        }}
      />,
    )
    // The engine's note already states the unchecked range, so the page does not say it twice.
    expect(screen.queryByText(/Sequences 1 to 11,004 were not checked/)).toBeNull()
    expect(screen.getAllByText(/Sequences 1 to 11,?004 were not (checked|verified)/)).toHaveLength(1)
    expect(screen.getByText("Sequences 1 to 11004 were not verified: the report verifies at most 50,000 sequences.")).toBeTruthy()
    expect(screen.getByText(/This check does not speak for the rest of the chain/)).toBeTruthy()
  })

  it("keeps its own capped sentence when the notes speak only of the tenants", () => {
    render(
      <ReportVerification
        report={{
          ...base,
          verification: { ...mixed, firstEvent: 11005, partial: true, retentionPolicies: -1 },
          verificationScope: scope({ fromSeq: 11005, capped: true, notes: ["Verification covered only the app's untenanted stream; each tenant's own stream was not verified."] }),
        }}
      />,
    )
    expect(screen.getByText(/Sequences 1 to 11,004 were not checked/)).toBeTruthy()
  })

  it("puts the capped limit before the verdict, so a reader meets it first", () => {
    render(
      <ReportVerification
        report={{ ...base, verification: { ...mixed, firstEvent: 11005, partial: true }, verificationScope: scope({ fromSeq: 11005, capped: true }) }}
      />,
    )
    const limit = screen.getByText(/Sequences 1 to 11,004 were not checked/)
    const verdict = screen.getByRole("heading", { name: /No alteration detected/ })
    expect(limit.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("says nothing about a cap when the scope was not capped", () => {
    render(<ReportVerification report={{ ...base, verification: report(), verificationScope: scope({ toSeq: 12431, headSeq: 12431 }) }} />)
    expect(screen.queryByText(/were not checked/)).toBeNull()
  })

  it("says an app-wide report verified only the app's own chain", () => {
    render(
      <ReportVerification
        report={{
          ...base,
          verification: { ...mixed, retentionPolicies: -1 },
          verificationScope: scope({ streamId: "stream_app", notes: ["This report has no tenant, so only the app's untenanted chain was verified."] }),
        }}
      />,
    )
    expect(screen.getByText(/only the app's untenanted chain was verified/)).toBeTruthy()
  })

  it("prints the no-checkpoints wording only when the scope says checkpoints are not configured", () => {
    const { unmount } = render(
      <ReportVerification report={{ ...base, verification: plainNoCheckpoints, verificationScope: scope({ checkpointsConfigured: false }) }} />,
    )
    expect(screen.getAllByText(/This deployment stores no checkpoints/).length).toBeGreaterThan(0)
    unmount()
    render(<ReportVerification report={{ ...base, verification: plainNoCheckpoints, verificationScope: scope({ checkpointsConfigured: true }) }} />)
    expect(screen.queryByText(/This deployment stores no checkpoints/)).toBeNull()
  })

  it("says nothing about checkpoint storage when the report carries no scope", () => {
    render(<ReportVerification report={{ ...base, verification: plainNoCheckpoints }} />)
    expect(screen.queryByText(/This deployment stores no checkpoints/)).toBeNull()
    expect(screen.getByText(/No corruption detected/)).toBeTruthy()
  })

  it("does not hide a verification that a no-chain scope contradicts", () => {
    render(<ReportVerification report={{ ...base, verification: report(), verificationScope: scope({ status: "no_chain" }) }} />)
    expect(screen.getByText(/No verification ran/)).toBeTruthy()
    expect(screen.getByText("This report's scope says no verification ran, but it carries a stored result, shown here as it was recorded.")).toBeTruthy()
    expect(screen.getByRole("heading", { name: /No alteration detected/ })).toBeTruthy()
  })

  it("labels a stored result under a not-configured scope the same way", () => {
    render(<ReportVerification report={{ ...base, verification: report(), verificationScope: scope({ status: "not_configured" }) }} />)
    expect(screen.getByText("This report's scope says no verification ran, but it carries a stored result, shown here as it was recorded.")).toBeTruthy()
  })

  it("puts the contradiction notice before the verdict", () => {
    render(<ReportVerification report={{ ...base, verification: report(), verificationScope: scope({ status: "no_chain" }) }} />)
    const notice = screen.getByText(/carries a stored result/)
    const verdict = screen.getByRole("heading", { name: /No alteration detected/ })
    expect(notice.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("does not print the contradiction notice for a verification that agrees with its scope", () => {
    render(<ReportVerification report={{ ...base, verification: report(), verificationScope: scope() }} />)
    expect(screen.queryByText(/carries a stored result/)).toBeNull()
    expect(screen.queryByText(/generated before chronicle recorded/)).toBeNull()
  })

  it("says an old report's verification has no recorded coverage, before its verdict", () => {
    render(<ReportVerification report={{ ...base, verification: report() }} />)
    const notice = screen.getByText("This report was generated before chronicle recorded what its verification covered, so the range and limits of this check are not known beyond what the result itself says.")
    const verdict = screen.getByRole("heading", { name: /No alteration detected/ })
    expect(notice.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("does not print the old-report notice when there is no verification at all", () => {
    render(<ReportVerification report={base} />)
    expect(screen.queryByText(/generated before chronicle recorded/)).toBeNull()
  })

  it("says so when a scope was recorded with no result to go with it", () => {
    render(<ReportVerification report={{ ...base, verificationScope: scope() }} />)
    expect(screen.getByText("This report records a verification scope but no verification result.")).toBeTruthy()
    expect(screen.queryByText("This report contains no integrity verification.")).toBeNull()
  })

  it("reads a retention qualifier as unknown when the report broke with gaps, since nobody counted policies", () => {
    render(
      <ReportVerification
        report={{ ...base, verification: report({ valid: false, gaps: [10], retentionPolicies: -1 }), verificationScope: scope() }}
      />,
    )
    expect(screen.getByText(/Whether a retention policy removed any of these sequences is unknown/)).toBeTruthy()
  })
})
