import type { ComponentType } from "react"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { BaselinesList } from "../components/baselines-list"

/** /baselines: every suite's baselines, newest first. */
export const BaselinesPage: ComponentType<PluginPageProps> = () => (
  <section className="flex min-w-0 flex-col gap-4">
    <PageHeader
      title="Baselines"
      description="A baseline is a saved run. Each suite compares its runs against its current one."
    />
    <BaselinesList />
  </section>
)
