import { PluginLink } from "@forge-go/dashboard-plugin"
import { Stat } from "@forge-go/dashboard-kit/components/stat-grid"
import { Read, useDispatchQuery } from "../read"
import { Facts, Frame, ResourceLink, Section } from "../components"
import type { OverviewSummary } from "../contract"

export function OverviewPage() {
  const query = useDispatchQuery<OverviewSummary>("overview.summary")
  return (
    <Frame
      title="Dispatch"
      description="Operator-wide job execution and workflow state. Counts come from the store."
    >
      <Read title="Overview" query={query} intervalMs={5_000}>
        {(data) => (
          <>
            <Section title="Jobs">
              <div className="grid grid-cols-2 gap-2 @xl/main:grid-cols-3 @5xl/main:grid-cols-6">
                {Object.entries(data.jobs.counts).map(([state, count]) => (
                  <PluginLink
                    key={state}
                    to={"/jobs?states=" + state}
                    className="rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Stat
                      label={state}
                      value={count}
                      tone={
                        state === "failed" && count > 0 ? "danger" : "default"
                      }
                    />
                  </PluginLink>
                ))}
              </div>
            </Section>
            <Section title="Workflows">
              <div className="grid grid-cols-1 gap-2 @xl/main:grid-cols-3">
                {Object.entries(data.runs).map(([state, count]) => (
                  <PluginLink
                    key={state}
                    to={"/workflows?state=" + state}
                    className="rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Stat
                      label={state}
                      value={count}
                      tone={
                        state === "failed" && count > 0 ? "danger" : "default"
                      }
                    />
                  </PluginLink>
                ))}
              </div>
            </Section>
            <Section title="Operations">
              <Facts
                items={[
                  [
                    "Dead letters",
                    <PluginLink to="/dlq" className="text-primary">
                      {data.unreplayedDeadLetters.toLocaleString()} unreplayed
                    </PluginLink>,
                  ],
                  [
                    "Cron",
                    <PluginLink to="/crons" className="text-primary">
                      {data.crons.enabled} enabled · {data.crons.disabled}{" "}
                      disabled
                    </PluginLink>,
                  ],
                  [
                    "Workers",
                    data.workers.enabled ? (
                      <PluginLink to="/workers" className="text-primary">
                        {data.workers.recent} recent · {data.workers.silent}{" "}
                        silent · {data.workers.unknown} unknown
                      </PluginLink>
                    ) : (
                      "Worker registry not configured"
                    ),
                  ],
                  [
                    "Leader",
                    !data.workers.enabled ? (
                      "Leadership unavailable"
                    ) : data.workers.leaderId ? (
                      <ResourceLink kind="workers" id={data.workers.leaderId} />
                    ) : (
                      "No current leader"
                    ),
                  ],
                  ["Silent after", data.workers.silentAfter?.text ?? "Unknown"],
                ]}
              />
            </Section>
          </>
        )}
      </Read>
    </Frame>
  )
}
