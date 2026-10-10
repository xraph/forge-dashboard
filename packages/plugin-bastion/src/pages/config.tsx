import type { ComponentType } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { EnabledBadge } from "../badges"
import type { ConfigDetail, ConfigSection } from "../types"

function Section({ s }: { s: ConfigSection }) {
  const headingId = `config-${s.id}`
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-2 rounded-lg border p-4"
    >
      <h2
        id={headingId}
        className="flex items-center gap-2 text-sm font-medium"
      >
        {s.title}
        {s.enabled === null ? null : <EnabledBadge enabled={s.enabled} />}
      </h2>
      {s.note ? (
        <p role="note" className="text-sm text-muted-foreground">
          {s.note}
        </p>
      ) : null}
      {s.settings.length === 0 ? (
        <NoneCell label="settings" />
      ) : (
        <DescriptionList
          items={s.settings.map((x) => ({
            term: x.key,
            value:
              x.value === "" ? (
                <NoneCell label="value" />
              ) : (
                <span className="font-mono text-xs">{x.value}</span>
              ),
          }))}
        />
      )}
    </section>
  )
}

export const BastionConfigPage: ComponentType<PluginPageProps> = () => {
  const query = useQuery<ConfigDetail>("config.detail")

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Config"
        description="The gateway's running configuration. Paths to keys and certificates show only as set or not set, and IP lists only as counts."
      />
      <QueryBoundary title="Config" query={query} skeletonRows={6}>
        {(c) => (
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            {c.sections.map((s) => (
              <Section key={s.id} s={s} />
            ))}
          </div>
        )}
      </QueryBoundary>
    </section>
  )
}
