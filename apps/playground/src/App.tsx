import { AppSidebar } from "@forge/dashboard-kit/components/app-sidebar"
import { ChartAreaInteractive } from "@forge/dashboard-kit/components/chart-area-interactive"
import { DataTable } from "@forge/dashboard-kit/components/data-table"
import { SectionCards } from "@forge/dashboard-kit/components/section-cards"
import { SiteHeader } from "@forge/dashboard-kit/components/site-header"
import { SidebarInset, SidebarProvider } from "@forge/dashboard-kit/components/sidebar"
import data from "@forge/dashboard-kit/app/dashboard/data.json"

export function App() {
  return (
    <SidebarProvider>
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-4">
          <SectionCards />
          <ChartAreaInteractive />
          <DataTable data={data} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
