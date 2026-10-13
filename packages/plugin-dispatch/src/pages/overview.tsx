import { PluginLink } from "@forge-go/dashboard-plugin"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import type { RenderStatLink } from "@forge-go/dashboard-kit/components/stat-grid"
import { Read, useDispatchQuery } from "../read"
import { Facts, Frame, ResourceLink } from "../components"
import type { OverviewSummary } from "../contract"

const renderLink: RenderStatLink = (href, cell) => (
  <PluginLink
    to={href}
    className="grid outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
  >
    {cell}
  </PluginLink>
)

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
              <StatGrid
                items={Object.entries(data.jobs.counts).map(
                  ([state, count]) => ({
                    label: state,
                    value: count,
                    tone:
                      state === "failed" && count > 0
                        ? ("danger" as const)
                        : ("default" as const),
                    href: "/jobs?states=" + state,
                  })
                )}
                renderLink={renderLink}
              />
            </Section>
            <Section title="Workflows">
              <StatGrid
                items={Object.entries(data.runs).map(([state, count]) => ({
                  label: state,
                  value: count,
                  tone:
                    state === "failed" && count > 0
                      ? ("danger" as const)
                      : ("default" as const),
                  href: "/workflows?state=" + state,
                }))}
                renderLink={renderLink}
              />
            </Section>
            <Section title="Operations" inset>
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
