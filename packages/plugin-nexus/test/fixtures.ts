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
