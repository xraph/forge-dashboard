import { Suspense } from "react"
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { PluginProvider } from "@forge-go/dashboard-plugin"
import heraldPlugin from "../src/index"
import { engine } from "./data"
import { stubClient } from "./harness"

const ANSWERS = {
  "engine.info": engine(),
  "overview.stats": {
    since: "2026-09-27T10:00:00Z",
    counts: [],
    providers: { total: 0, enabled: 0 },
    credentials: { plaintext: 0, encrypted: 0 },
    templatesWithoutFallback: [],
  },
  "providers.list": { providers: [] },
  "templates.list": { templates: [] },
  "messages.list": { messages: [] },
  "scopes.list": { rules: [] },
}

/** Text that belongs to one page alone, so a route wired to the wrong page fails. */
const EXPECTED: Record<string, string | RegExp> = {
  "/": "Messages by status and channel",
  "/providers": /No providers yet/,
  "/providers/:id":
    /No provider ID in the address, so there is nothing to show/,
  "/new-provider": "New provider",
  "/providers/:id/edit":
    /No provider ID in the address, so there is nothing to edit/,
  "/templates": /No templates yet/,
  "/templates-without-fallback": "Templates without a fallback",
  "/new-template": "New template",
  "/templates/:id":
    /No template ID in the address, so there is nothing to show/,
  "/messages": /Nothing has been sent in this app yet/,
  "/messages/:id": /No message ID in the address/,
  "/inbox": /Enter a user ID to see their in-app notifications/,
  "/preferences": /Enter a user ID to see their preferences/,
  "/routing": "Who sends?",
  "/send-test": /Sends a real message to a real recipient/,
  "/providers/:providerId/send-test":
    /Sends a real message to a real recipient/,
  "/messages/:messageId/send-test": /Sends a real message to a real recipient/,
}

describe("routes", () => {
  it("names an expectation for every route", () => {
    expect(heraldPlugin.routes.map((r) => r.path).sort()).toEqual(
      Object.keys(EXPECTED).sort()
    )
  })

  it.each(heraldPlugin.routes.map((r) => [r.path, r] as const))(
    "%s mounts its own page",
    async (path, route) => {
      const Page = route.element
      render(
        <PluginProvider client={stubClient(ANSWERS)}>
          <Suspense fallback={null}>
            <Page params={{}} />
          </Suspense>
        </PluginProvider>
      )
      expect(await screen.findAllByText(EXPECTED[path])).not.toHaveLength(0)
    }
  )
})
