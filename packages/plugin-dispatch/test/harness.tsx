import { beforeEach } from "vitest"
import { render } from "@testing-library/react"
import type { ReactNode } from "react"
import {
  ContractError,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
beforeEach(() => queryStore.clear())
type Handler = (value?: unknown) => unknown | Promise<unknown>
export function clientFor(
  queries: Record<string, Handler>,
  commands: Record<string, Handler> = {}
): ScopedClient {
  async function call<T>(
    handlers: Record<string, Handler>,
    intent: string,
    payload?: unknown
  ): Promise<T> {
    if (!handlers[intent])
      throw new ContractError("NOT_FOUND", "Unknown intent " + intent)
    return (await handlers[intent](payload)) as T
  }
  return {
    extension: "dispatch",
    query: (intent, params) => call(queries, intent, params),
    command: (intent, payload) => call(commands, intent, payload),
  }
}
export function renderWithClient(children: ReactNode, client: ScopedClient) {
  return render(<PluginProvider client={client}>{children}</PluginProvider>)
}
