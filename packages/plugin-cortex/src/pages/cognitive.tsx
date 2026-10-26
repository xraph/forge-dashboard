import { useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"

export interface ReflectionReview {
  version: number
  at: string
  step: number
  decision: {
    action: string
    reason: string
    phase: number
    phase_changed: boolean
  }
  state: { reflections: number; pending: boolean; control_revision: number }
  evidence_available: boolean
  assumptions: { key: string; summary: string; origin: string; state: string }[]
}
export interface CognitiveReview {
  available: boolean
  reason?: string
  items: ReflectionReview[]
  after?: number
  reliability?: { status: string; reason?: string }
}

export function CognitiveRunReview({ runId }: { runId: string }) {
  const [cursors, setCursors] = useState([0])
  const after = cursors[cursors.length - 1]!
  const query = useQuery<CognitiveReview>("cognitive.review", {
    id: runId,
    after,
    limit: 10,
  })
  return (
    <Section title="Decisions and uncertainty">
      <div className="px-3 pt-3">
        <PluginLink to="/improvements" className="text-sm underline">
          Review proposed improvements
        </PluginLink>
      </div>
      <QueryBoundary title="Decision history" query={query} keepPreviousData>
        {(data) =>
          !data.available ? (
            <ZeroState
              title="Decision review unavailable"
              body={
                data.reason ??
                "Your host has not installed authorized history review."
              }
            />
          ) : data.items.length === 0 ? (
            <ZeroState
              title="No reflection decisions"
              body="This run has no recorded decisions in this window. Reliability remains unknown without a compatible measured cohort."
            />
          ) : (
            <div className="grid min-w-0 gap-2 p-3">
              <p className="text-xs text-muted-foreground">
                Historical observations. Reliability:{" "}
                {data.reliability?.status ?? "unknown"}. A reflection decision
                does not certify the result.
              </p>
              {data.items.map((item) => (
                <article
                  key={item.version}
                  className="grid min-w-0 gap-2 rounded-md border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      Decision {item.version} · step {item.step} ·{" "}
                      {item.decision.action}
                    </span>
                    <Timestamp value={item.at} label="decision recorded" />
                  </div>
                  <p className="text-sm">
                    {item.decision.reason.replaceAll("_", " ")} · phase{" "}
                    {item.decision.phase + 1} · {item.state.reflections}{" "}
                    reflections
                    {item.state.pending ? " · awaiting resolution" : ""}
                  </p>
                  {!item.evidence_available && (
                    <p className="text-xs text-muted-foreground">
                      Source evidence is no longer available. Its claims are
                      withheld.
                    </p>
                  )}
                  {(item.assumptions ?? []).map((assumption) => (
                    <p key={assumption.key} className="text-sm break-words">
                      <span className="font-medium">{assumption.state}</span> ·{" "}
                      {assumption.summary}{" "}
                      <span className="text-muted-foreground">
                        ({assumption.origin} observation)
                      </span>
                    </p>
                  ))}
                </article>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <PluginLink to="/learning" className="text-sm underline">
                  Governed lessons
                </PluginLink>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={query.loading || cursors.length === 1}
                    onClick={() =>
                      setCursors((current) => current.slice(0, -1))
                    }
                  >
                    Previous decisions
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={query.loading || !data.after}
                    onClick={() =>
                      setCursors((current) => [...current, data.after!])
                    }
                  >
                    Next decisions
                  </Button>
                </div>
              </div>
            </div>
          )
        }
      </QueryBoundary>
    </Section>
  )
}
