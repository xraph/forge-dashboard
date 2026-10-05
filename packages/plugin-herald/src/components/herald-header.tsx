import type { ReactNode } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { QueryState } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import type { EngineInfoResponse } from "../wire"

/** engine.info, shared by every page through the query cache. */
export function useEngineInfo(): QueryState<EngineInfoResponse> {
  return useQuery<EngineInfoResponse>("engine.info")
}

/**
 * Which app this page shows. Under authsome an empty list reads as "nothing
 * was sent" when it means "nothing in this app", so every page says which
 * app it is reading.
 */
export function AppLine({ info }: { info: QueryState<EngineInfoResponse> }) {
  if (info.error) {
    return (
      <p className="text-sm text-muted-foreground">
        App unknown: {info.error.code}: {info.error.message}
      </p>
    )
  }
  if (!info.data) {
    return (
      <p className="text-sm text-muted-foreground" aria-busy="true">
        App: loading…
      </p>
    )
  }
  const app = info.data.app
  return (
    <p className="text-sm text-muted-foreground">
      App: {app.id === "" ? <span>{app.label}</span> : <span className="font-mono text-xs">{app.id}</span>}
    </p>
  )
}

export function HeraldHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  const info = useEngineInfo()
  return (
    <div className="flex flex-col gap-1">
      <PageHeader title={title} description={description} actions={actions} />
      <AppLine info={info} />
    </div>
  )
}
