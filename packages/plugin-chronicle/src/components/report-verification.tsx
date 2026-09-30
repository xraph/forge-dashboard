import type { ReportDetail } from "../types"
import { formatSeq } from "../format"
import { Certificate } from "../verification/certificate"

/**
 * A report's integrity section. It is never omitted: an auditor reading a
 * report with no section cannot tell "verified and fine" from "nobody
 * looked". The verification and its scope are read together: a valid verdict
 * on a capped scope proves only the window, and the page says which
 * sequences went unchecked.
 */
export function ReportVerification({ report }: { report: ReportDetail }) {
  const scope = report.verificationScope
  const v = report.verification

  let reason: string | null = null
  if (scope?.status === "no_chain") {
    reason = "No verification ran: this scope has no hash chain of its own, so there was nothing to check. A report with no tenant checks only the app-level chain, not its tenants' chains."
  } else if (scope?.status === "not_configured") {
    reason = "No verification ran: this deployment gives the report engine no hash chain, so it could not check anything."
  } else if (!v) {
    reason = scope
      ? "This report records a verification scope but no verification result."
      : "This report contains no integrity verification."
  }

  const contradicted = v !== undefined && (scope?.status === "no_chain" || scope?.status === "not_configured")
  // The engine's own note names the unchecked range when it writes one
  // ("Sequences below 11005 were not verified"), and saying it twice reads as
  // two separate gaps. A note about the tenants' chains is not that note.
  const notesStateCap = (scope?.notes ?? []).some((n) => /\bsequences\b.*\bwere not\b/i.test(n))

  return (
    <section aria-labelledby="report-integrity" className="flex flex-col gap-3">
      <h2 id="report-integrity" className="text-lg font-medium">
        Integrity
      </h2>
      {reason && <p>{reason}</p>}
      {/* A verification that came with a contradicting scope is still shown: hiding a result is the one thing this section must not do. */}
      {v && (
        <div className="flex flex-col gap-4">
          {contradicted && <p className="font-medium">This report&apos;s scope says no verification ran, but it carries a stored result, shown here as it was recorded.</p>}
          {!scope && (
            <p className="font-medium">
              This report was generated before chronicle recorded what its verification covered, so the range and limits of this check are not known beyond what the result itself says.
            </p>
          )}
          {scope?.capped && scope.fromSeq > 1 && !notesStateCap && (
            <p className="font-medium">
              {`Sequences 1 to ${formatSeq(scope.fromSeq - 1)} were not checked: a report verifies at most the newest ${formatSeq(scope.window)} sequences, ending at the head.`}
            </p>
          )}
          <Certificate response={{ noChain: false, report: v }} checkpointingConfigured={scope?.checkpointsConfigured} />
        </div>
      )}
      {scope && scope.notes.length > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {scope.notes.map((n, i) => (
            <li key={`${i}-${n}`}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
