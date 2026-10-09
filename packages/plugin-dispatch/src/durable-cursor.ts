import { useState, useSyncExternalStore } from "react"
import { queryStore, usePluginClient } from "@forge-go/dashboard-plugin"
import { useCursor } from "./cursor"

/** Reset before constructing params, on client replacement or host context clear. */
export function useDurableCursor(filterKey: string) {
  const client = usePluginClient()
  const epoch = useSyncExternalStore(
    queryStore.subscribeContext,
    queryStore.contextSnapshot,
    queryStore.contextSnapshot
  )
  const [owner, setOwner] = useState({ client, version: 0 })
  const version = owner.client === client ? owner.version : owner.version + 1
  if (owner.client !== client) setOwner({ client, version })
  return useCursor(JSON.stringify([epoch, version, filterKey]))
}
