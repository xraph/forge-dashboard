import { Fragment, useState, useSyncExternalStore } from "react"
import type { ReactNode } from "react"
import { queryStore, usePluginClient } from "@forge-go/dashboard-plugin"

/** Ordinary invalidation leaves this owner intact; identity/context clear does not. */
export function DurableSession({ children }: { children: ReactNode }) {
  const client = usePluginClient()
  const epoch = useSyncExternalStore(
    queryStore.subscribeContext,
    queryStore.contextSnapshot,
    queryStore.contextSnapshot
  )
  const [owner, setOwner] = useState({ client, version: 0 })
  const version = owner.client === client ? owner.version : owner.version + 1
  if (owner.client !== client) setOwner({ client, version })
  return <Fragment key={`${epoch}:${version}`}>{children}</Fragment>
}
