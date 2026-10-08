import { beforeEach } from "vitest"
import {
  createNexusHandlers,
  resetNexus,
} from "../../fixture-server/nexus-fixtures.mjs"
import { clientFor } from "./harness"

class FixtureError extends Error {
  code: string
  constructor(_status: number, code: string, message: string) {
    super(message)
    this.code = code
  }
}
const handlers = createNexusHandlers(FixtureError)
beforeEach(resetNexus)
export const answer = <T>(
  intent: string,
  params: Record<string, unknown> = {}
) => handlers[intent].handler(params) as T
export function fixtureClient(overrides: Record<string, unknown> = {}) {
  return clientFor({
    ...Object.fromEntries(
      Object.entries(handlers)
        .filter(([, h]) => h.kind === "query")
        .map(([intent, h]) => [intent, h.handler])
    ),
    ...overrides,
  })
}

export function commandClient(
  overrides: Record<string, (payload: Record<string, unknown>) => unknown> = {}
) {
  const result = fixtureClient()
  const commands: {
    intent: string
    payload: Record<string, unknown>
    options?: import("@forge-go/dashboard-plugin").CommandOptions
  }[] = []
  result.client.command = async <T>(
    intent: string,
    payload?: unknown,
    options?: import("@forge-go/dashboard-plugin").CommandOptions
  ): Promise<T> => {
    const input = (payload ?? {}) as Record<string, unknown>
    commands.push({ intent, payload: input, options })
    const handler = handlers[intent]
    const value = await (overrides[intent] ?? handler.handler)(input)
    const { queryStore } = await import("@forge-go/dashboard-plugin")
    queryStore.invalidate("nexus", handler.invalidates ?? [])
    return value as T
  }
  return { ...result, commands }
}
