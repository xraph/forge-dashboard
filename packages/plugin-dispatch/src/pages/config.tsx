import { Section } from "@forge-go/dashboard-kit/components/section"
import { Read, useDispatchQuery } from "../read"
import { Facts, Frame, ResourceLink, SettingValue } from "../components"
import type { EngineConfig } from "../contract"
export function EnginePage() {
  const query = useDispatchQuery<EngineConfig>("engine.config")
  return (
    <Frame
      title="Engine"
      description="Read-only configuration and measurements for the process serving this page."
    >
      <Read title="Engine configuration" query={query}>
        {(data) => (
          <>
            <Section aria-label="Process details" inset>
              <Facts
                items={[
                  [
                    "Worker",
                    <ResourceLink kind="workers" id={data.workerId} />,
                  ],
                  ["Scratch root", data.scratchRoot || "Not configured"],
                  [
                    "Wake notifier",
                    data.wakeNotifierSupported ? "Supported" : "Not supported",
                  ],
                ]}
              />
            </Section>
            <div className="grid min-w-0 gap-4 @3xl/main:grid-cols-2">
              <Section title="Pool and polling" inset>
                <SettingValue value={data.pool} />
              </Section>
              <Section title="Cron scheduler" inset>
                <SettingValue value={data.scheduler} />
              </Section>
              <Section title="Queues" inset>
                <SettingValue value={data.queues} />
              </Section>
              <Section
                title="Execution"
                description="Requested operating-system limits describe configuration. They do not prove enforcement."
                inset
              >
                <SettingValue value={data.executors} />
              </Section>
              <Section title="Resources" inset>
                <Facts
                  items={[
                    ["Enabled", data.resources.enabled ? "Yes" : "No"],
                    [
                      "Defaults",
                      <SettingValue value={data.resources.defaults} rawKeys />,
                    ],
                    [
                      "Queues",
                      <SettingValue value={data.resources.queues} rawKeys />,
                    ],
                    [
                      "Advertised worker capacity",
                      <SettingValue
                        value={data.resources.advertisedWorkerCapacity}
                        rawKeys
                      />,
                    ],
                    [
                      "Custom keys",
                      <SettingValue value={data.resources.customKeys} />,
                    ],
                    [
                      "Estimator configured",
                      data.resources.estimatorConfigured ? "Yes" : "No",
                    ],
                  ]}
                />
              </Section>
              <Section title="Artifacts" inset>
                <SettingValue value={data.artifacts} />
              </Section>
            </div>
          </>
        )}
      </Read>
    </Frame>
  )
}
