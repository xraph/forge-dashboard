import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"

/** Rescans discovery. Used by the routes and services pages. */
export function RefreshDiscovery() {
  const refresh = useCommand<{ ok: boolean }>("discovery.refresh")
  const [refreshed, setRefreshed] = useState(false)

  async function run() {
    setRefreshed(false)
    const r = await refresh.execute()
    if (r !== undefined) setRefreshed(true)
  }

  const error =
    refresh.error?.code === "CONFLICT" &&
    refresh.error.details?.reason === "discoveryOff"
      ? {
          code: refresh.error.code,
          message:
            "Discovery is switched off in the gateway config, so there is nothing to refresh.",
        }
      : refresh.error

  return (
    <div className="flex min-w-0 flex-col items-end gap-2">
      <IconButton
        variant="outline"
        disabled={refresh.loading}
        onClick={() => void run()}
        label={refresh.loading ? "Refreshing…" : "Refresh discovery"}
      />
      <CommandAlert title="Could not refresh discovery" error={error} />
      {refreshed ? (
        <p role="status" className="text-sm text-muted-foreground">
          Discovery refreshed.
        </p>
      ) : null}
    </div>
  )
}
