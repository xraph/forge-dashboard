import { createContext, useContext } from "react"
import type { ReactNode } from "react"
import type { ScopedClient } from "./client"

const ClientContext = createContext<ScopedClient | null>(null)

/** Wraps one plugin's subtree, supplying the client scoped to that plugin. */
export function PluginProvider({
  client,
  children,
}: {
  client: ScopedClient
  children: ReactNode
}) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
}

export function usePluginClient(): ScopedClient {
  const client = useContext(ClientContext)
  if (!client) {
    throw new Error(
      "usePluginClient was called outside a PluginProvider. Plugin components " +
        "only render inside the dashboard host.",
    )
  }
  return client
}
