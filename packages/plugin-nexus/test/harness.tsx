import type { ReactNode } from "react"
import { beforeEach } from "vitest"
import { render } from "@testing-library/react"
import {
  ContractError,
  PluginProvider,
  queryStore,
  type ScopedClient,
} from "@forge-go/dashboard-plugin"

beforeEach(() => queryStore.clear())

export function clientFor(
  answers: Record<
    string,
    unknown | ((params: Record<string, unknown>) => unknown)
  >
) {
  const sent: { intent: string; params?: Record<string, unknown> }[] = []
  const client = {
    extension: "nexus",
    async query(intent: string, params: Record<string, unknown> = {}) {
      sent.push({ intent, params })
      if (!(intent in answers))
        throw new ContractError("NOT_FOUND", `No handler for ${intent}`)
      const answer = answers[intent]
      return typeof answer === "function" ? answer(params) : answer
    },
    async command() {
      throw new ContractError("NOT_FOUND", "No command handler")
    },
  } as ScopedClient
  return { client, sent }
}

export function renderWithClient(children: ReactNode, client: ScopedClient) {
  return render(<PluginProvider client={client}>{children}</PluginProvider>)
}
