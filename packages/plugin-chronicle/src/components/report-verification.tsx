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
    reason = "No verification ran: this scope had not recorded any events when the report was generated."
  } else if (scope?.status === "not_configured") {
    reason = "No verification ran: this deployment gives the report engine no hash chain, so it could not check anything."
  } else if (!v) {
    reason = scope
      ? "This report records a verification scope but no verification result."
      : "This report contains no integrity verification."
  }

  return (
    <section aria-labelledby="report-integrity" className="flex flex-col gap-3">
      <h2 id="report-integrity" className="text-lg font-medium">
        Integrity
      </h2>
      {reason && <p>{reason}</p>}
      {/* A verification that came with a contradicting scope is still shown: hiding a result is the one thing this section must not do. */}
      {v && (
        <div className="flex flex-col gap-4">
          {scope?.capped && scope.fromSeq > 1 && (
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
