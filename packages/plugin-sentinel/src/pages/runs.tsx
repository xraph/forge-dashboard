import type { ComponentType } from "react"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { RunsList } from "../components/runs-list"

/** Every run in the app, newest first, with suite and state filters. */
export const RunsPage: ComponentType<PluginPageProps> = () => (
  <section className="flex min-w-0 flex-col gap-4">
    <PageHeader
      title="Runs"
      description="Each run sends a suite's cases to a target and scores what comes back. Start one from its suite."
    />
    <RunsList />
  </section>
)
