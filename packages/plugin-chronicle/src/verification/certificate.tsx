import type { ReactNode } from "react"
import type { VerifyResponse } from "../types"
import { CoverageBadge } from "../badges"
import { formatSeq } from "../format"
import { breakAnchor, breaksOf } from "./breaks"
import { checkpointRows, checksOf, type CheckRow } from "./checks"
import { Ribbon } from "./ribbon"
import { TriStateMark } from "./tri-state"
import { verdictOf } from "./verdict"

/**
 * A verification result as a certificate of analysis: what was examined, by
 * what method, over what range, what was found, and what the method cannot
 * see, in that order, as one document. No card grid: cards chop one argument
 * into unrelated tiles.
 */
export function Certificate({
  response,
  checkpointingConfigured,
}: {
  response: VerifyResponse
  /** Whether the deployment stores checkpoints. Undefined when the caller does not know, and then nothing is said about it. */
  checkpointingConfigured?: boolean
}) {
  const ctx = { checkpointingConfigured }
  const v = verdictOf(response, ctx)
  const r = response.report
  const failed = v.tone === "failed"

  const verdict = (
    <div>
      <h2 className={`max-w-3xl text-balance text-2xl font-normal leading-snug tabular-nums md:text-3xl ${failed ? "text-destructive" : ""}`}>
        {v.headline.map((p, i) =>
          p.mono ? (
            <span key={i} className="font-mono">
              {p.text}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </h2>
      {v.qualifiers.map((q) => (
        <p key={q} className="mt-2 max-w-prose text-base">
          {q}
        </p>
      ))}
    </div>
  )

  if (!r) return <article className="flex flex-col gap-6">{verdict}</article>

  const limits =
    v.limits.length > 0 ? (
      <Section title="What this check cannot see" loud={v.limitsLoud}>
        <ul className={v.limitsLoud ? "flex flex-col gap-2 text-base font-medium" : "flex flex-col gap-1 text-sm"}>
          {v.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Section>
    ) : null

  const breaks = breaksOf(r)
  // The ribbon is scaled to the range that was examined. Scaled to the head, a
  // check of 2,730 to 2,830 on a long chain would stack every marker at the
  // left edge, and the ribbon exists so a break's position can be seen.
  const examined = r.verified > 0
  const from = r.firstEvent
  const to = r.lastEvent

  return (
    <article className="flex flex-col gap-8">
      {verdict}
      {limits}
      {examined && (
        <Section title="Where">
          <Ribbon report={r} fromSeq={from} toSeq={to} />
          <p className="mt-1 flex justify-between font-mono text-xs text-muted-foreground">
            <span>{formatSeq(from)}</span>
            <span>{formatSeq(to)}</span>
          </p>
          {to < r.headSeq && <p className="mt-2 text-sm">{`The chain's head is at sequence ${formatSeq(r.headSeq)}.`}</p>}
        </Section>
      )}
      {breaks.length > 0 && (
        <Section title="What was found">
          <table className="w-full text-sm">
            <caption className="sr-only">{`${breaks.length} breaks`}</caption>
            <tbody>
              {breaks.map((b) => (
                <tr key={breakAnchor(b)} id={breakAnchor(b)} tabIndex={-1} className="border-b align-top focus:bg-muted focus:outline-none">
                  <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">
                    {b.fromSeq === b.toSeq ? formatSeq(b.fromSeq) : `${formatSeq(b.fromSeq)} to ${formatSeq(b.toSeq)}`}
                  </td>
                  <td className="py-2">
                    <div className="font-medium text-destructive">{b.title}</div>
                    <div className="text-muted-foreground">{b.explanation}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
      {(r.retained ?? []).length > 0 && (
        <Section title="Removed by retention">
          <ul className="flex flex-col gap-1 text-sm">
            {(r.retained ?? []).map((rg) => (
              <li key={rg.fromSeq}>
                <span className="font-mono text-xs">
                  {formatSeq(rg.fromSeq)} to {formatSeq(rg.toSeq)}
                </span>
                {", recorded at sequence "}
                <span className="font-mono text-xs">{formatSeq(rg.recordSeq)}</span>
                {rg.policyId ? (
                  <>
                    {" under "}
                    <span className="font-mono text-xs">{rg.policyId}</span>
                  </>
                ) : null}
                {rg.backfill ? `, recovered from ${rg.backfill}` : ""}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="What was examined">
        <p className="mb-3 text-sm">
          {examined ? `${formatSeq(r.verified)} events read, sequences ${formatSeq(from)} to ${formatSeq(to)}.` : "No events were read."}
        </p>
        <CheckTable rows={checksOf(r, ctx)} />
        {(r.checkpoints ?? []).map((c) => (
          <div key={c.id} className="mt-4">
            <p className="text-sm">
              Checkpoint <span className="font-mono text-xs">{c.id}</span>, sequences{" "}
              <span className="font-mono text-xs">
                {formatSeq(c.fromSeq)} to {formatSeq(c.toSeq)}
              </span>
            </p>
            <CheckTable rows={checkpointRows(c)} />
          </div>
        ))}
      </Section>
      <Section title="Coverage">
        <ul className="flex flex-col gap-1 text-sm">
          {(r.coverage ?? []).map((s) => (
            <li key={`${s.fromSeq}-${s.level}`} className="flex items-center gap-2">
              <CoverageBadge level={s.level} />
              <span className="font-mono text-xs">{formatSeq(s.fromSeq)}</span>
              <span>to</span>
              <span className="font-mono text-xs">{formatSeq(s.toSeq)}</span>
              {s.note ? <span className="text-muted-foreground">{s.note}</span> : null}
            </li>
          ))}
        </ul>
      </Section>
    </article>
  )
}

function Section({ title, loud, children }: { title: string; loud?: boolean; children: ReactNode }) {
  const id = `cert-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`
  return (
    <section aria-labelledby={id} data-loud={loud ? "true" : undefined} className={loud ? "border-l-2 border-foreground pl-4" : ""}>
      <h3 id={id} className="mb-2 text-sm font-medium text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}

function CheckTable({ rows }: { rows: CheckRow[] }) {
  return (
    <dl className="grid grid-cols-[12rem_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt>{row.label}</dt>
          <dd>
            <TriStateMark state={row.state} held={row.held} failed={row.failed} notChecked={row.notChecked} />
          </dd>
        </div>
      ))}
    </dl>
  )
}
