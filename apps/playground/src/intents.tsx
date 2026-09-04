import { lazy, Suspense } from "react"
import { IntentRegistry, SlotRenderer } from "@forge/dashboard-runtime"
import type { IntentComponentProps } from "@forge/dashboard-runtime"
import { AppSidebar } from "@forge/dashboard-kit/components/app-sidebar"
import { SectionCards } from "@forge/dashboard-kit/components/section-cards"
import { SiteHeader } from "@forge/dashboard-kit/components/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "@forge/dashboard-kit/components/sidebar"

// Measured at 1,008KB raw on its own, because data-table pulls recharts for
// its row drawer. It must never enter the eager chunk. Same for the chart.
const DataTable = lazy(async () => ({
  default: (await import("@forge/dashboard-kit/components/data-table"))
    .DataTable,
}))
const ChartAreaInteractive = lazy(async () => ({
  default: (
    await import("@forge/dashboard-kit/components/chart-area-interactive")
  ).ChartAreaInteractive,
}))

function PageShell({ slots }: IntentComponentProps) {
  return (
    <SidebarProvider>
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-4">
          <SlotRenderer slot="main" slots={slots} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function DashboardStats() {
  return <SectionCards />
}

function OrganismChart() {
  return (
    <Suspense
      fallback={<div className="h-64 animate-pulse rounded-md bg-muted" />}
    >
      <ChartAreaInteractive />
    </Suspense>
  )
}

function OrganismDataGrid({ props }: IntentComponentProps<{ rows?: unknown }>) {
  return (
    <Suspense
      fallback={<div className="h-96 animate-pulse rounded-md bg-muted" />}
    >
      <DataTable data={(props.rows ?? []) as never} />
    </Suspense>
  )
}

export function buildIntentRegistry(): IntentRegistry {
  return new IntentRegistry()
    .register("page.shell", PageShell)
    .register("dashboard.stat", DashboardStats)
    .register("organism.chart", OrganismChart)
    .register("organism.data-grid", OrganismDataGrid)
}
