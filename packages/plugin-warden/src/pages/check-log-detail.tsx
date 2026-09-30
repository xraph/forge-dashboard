import type { ReactNode } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import {
  CheckRequestLine,
  decisionVariant,
  formatEvalTime,
  type CheckDetail,
  type CheckMatch,
} from "../components/check-log"
import { NamespaceCell } from "../components/namespace-filter"

/**
 * How each match source reads, and where its rule can be opened.
 *
 * Only the sources the engine writes have an entry. A source that is not here
 * shows raw and never links, because a guessed route is a link to nowhere.
 * `rebac` has a word and no link: a relation match records no rule id, and
 * there is no page for one relation tuple.
 */
const SOURCES: Record<string, { word: string; href?: (ruleId: string) => string }> = {
  rbac: { word: "role", href: (id) => `/roles/${id}` },
  abac: { word: "policy", href: (id) => `/policies/${id}` },
  rebac: { word: "relation" },
}

const LINK_CLASS = "underline underline-offset-4"

/** The link a match gets, or null. Needs a known linking source and a rule id. */
function matchHref(m: CheckMatch): string | null {
  if (!m.ruleId || !Object.hasOwn(SOURCES, m.source)) return null
  return SOURCES[m.source].href?.(m.ruleId) ?? null
}

function Match({ match }: { match: CheckMatch }) {
  const known = Object.hasOwn(SOURCES, match.source)
  const href = matchHref(match)
  // A link needs text. The recorded detail is what reads well; the rule id is
  // the fallback for a row that recorded none.
  const text = match.detail ? (
    match.detail
  ) : match.ruleId ? (
    <span className="font-mono text-xs">{match.ruleId}</span>
  ) : (
    <NoneCell label="detail" />
  )
  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-3 text-sm">
      {known ? (
        <span className="text-muted-foreground">{SOURCES[match.source].word}</span>
      ) : (
        <span className="font-mono text-xs">{match.source}</span>
      )}
      <span>
        {href ? (
          <PluginLink to={href} className={LINK_CLASS}>
            {text}
          </PluginLink>
        ) : (
          text
        )}
      </span>
    </li>
  )
}

/** A labelled row, term in a lowercase column of fixed width so rows align. */
function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-x-4 text-sm">
      <dt className="text-muted-foreground">{term}</dt>
      <dd>{children}</dd>
    </dl>
  )
}

function mono(value: string | undefined, label: string) {
  return value ? <span className="font-mono text-xs">{value}</span> : <NoneCell label={label} />
}

export function WardenCheckLogDetailPage({ params }: PluginPageProps) {
  const id = params.id as string
  const detail = useQuery<CheckDetail>("checkLogs.detail", { id })

  return (
    <QueryBoundary title="Check" query={detail} skeletonRows={4}>
      {(check) => {
        const matches = check.matchedBy ?? []
        const obligations = check.obligations ?? []
        const failed = check.decision === "error"
        const linked = matches.some((m) => matchHref(m) !== null)

        return (
          <section className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <PageHeader title="Check" />
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                <CheckRequestLine check={check} />
                <span className="text-muted-foreground">
                  in <NamespaceCell path={check.namespacePath} />
                </span>
              </p>
            </div>

            <DetailLayout
              main={
                <>
                  <Row term="decision">
                    <span className="flex flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge variant={decisionVariant(check.decision)}>{check.decision}</Badge>
                        {!failed && check.reason && (
                          <span className="text-muted-foreground">{check.reason}</span>
                        )}
                        {failed && (
                          <span className="text-destructive">
                            {check.error || <NoneCell label="error" />}
                          </span>
                        )}
                      </span>
                      {failed && (
                        <span className="text-muted-foreground">
                          The check failed with this error, so no decision was returned.
                        </span>
                      )}
                    </span>
                  </Row>

                  {!failed && matches.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <Row term="decided by">
                        <ul className="flex flex-col gap-1">
                          {matches.map((m, i) => (
                            <Match key={`${i}-${m.source}-${m.ruleId ?? ""}`} match={m} />
                          ))}
                        </ul>
                      </Row>
                      {linked && (
                        <p className="text-xs text-muted-foreground">
                          Each link opens the rule as it is now, which may have changed or been
                          deleted since this check ran.
                        </p>
                      )}
                    </div>
                  )}
                  {!failed && matches.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No rule is recorded for this decision.
                    </p>
                  )}

                  {!failed && obligations.length > 0 && (
                    <Row term="emits">
                      <span className="flex flex-wrap gap-1.5">
                        {obligations.map((o, i) => (
                          <Badge key={`${i}-${o}`} variant="outline" className="font-mono text-xs">
                            {o}
                          </Badge>
                        ))}
                      </span>
                    </Row>
                  )}

                  {!failed && check.cached && (
                    <p className="text-sm text-muted-foreground">
                      Served from the result cache. The engine reused a decision it made earlier
                      and evaluated no rule for this check.
                    </p>
                  )}

                  {!failed && (
                    <Row term={check.cached ? "lookup time" : "evaluation time"}>
                      <span className="tabular-nums">{formatEvalTime(check.evalTimeNs)}</span>
                    </Row>
                  )}
                </>
              }
              aside={
                <DescriptionList
                  items={[
                    { term: "Check id", value: mono(check.id, "check id") },
                    { term: "Namespace", value: <NamespaceCell path={check.namespacePath} /> },
                    { term: "App id", value: mono(check.appId, "app id") },
                    { term: "Request IP", value: mono(check.requestIp, "request ip") },
                    { term: "Request id", value: mono(check.requestId, "request id") },
                    { term: "Trace id", value: mono(check.traceId, "trace id") },
                    { term: "When", value: <Timestamp value={check.createdAt} label="checked at" /> },
                  ]}
                />
              }
            />
          </section>
        )
      }}
    </QueryBoundary>
  )
}
