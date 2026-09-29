import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import relayPlugin, { relayPlugin as named } from "../src/index"
import { screen } from "@testing-library/react"
import { renderPage, stubClient } from "./harness"

function capabilities(
  ...contributors: { name: string; configured?: boolean; message?: string }[]
): Capabilities {
  return {
    shellEnvelopes: ["v1"],
    contributors: contributors.map((c) => ({
      name: c.name,
      envelopes: ["v1"],
      configured: c.configured ?? true,
      ...(c.message ? { message: c.message } : {}),
    })),
  }
}

describe("relayPlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(relayPlugin).toBe(named)
  })

  /**
   * The join key, checked the way the host uses it rather than against a
   * literal (which would compare this file's source to itself). "relay" is
   * what relay/extension/contract/manifest.yaml registers.
   */
  it("resolves to ready against a host reporting relay's contributor", () => {
    expect(
      resolvePluginState(relayPlugin, capabilities({ name: "relay" }))
    ).toEqual({ kind: "ready" })
  })

  // Streaming's contributor is "streaming-contract", so the tempting wrong
  // value here is the same suffix. Relay's contributor has none, and a host
  // reporting "relay-contract" is not reporting relay.
  it("is hidden when the host reports a different contributor name", () => {
    expect(
      resolvePluginState(relayPlugin, capabilities({ name: "relay-contract" }))
    ).toEqual({ kind: "hidden" })
  })

  it("asks for setup when the contributor is present but unconfigured", () => {
    expect(
      resolvePluginState(
        relayPlugin,
        capabilities({
          name: "relay",
          configured: false,
          message: "Configure a store for relay",
        })
      )
    ).toEqual({ kind: "setup", message: "Configure a store for relay" })
  })

  // Scope-relative: the host mounts these under /@relay itself.
  it("declares the routes it serves, scope-relative", () => {
    expect(relayPlugin.routes.map((r) => r.path)).toEqual([
      "/",
      "/deliveries",
      "/deliveries/:id",
      "/events",
      "/events/send",
      "/events/:id",
      "/dlq",
      "/dlq/:id",
      "/endpoints",
      "/endpoints/new",
      "/endpoints/:id",
      "/event-types",
      "/event-types/new",
      "/event-types/:name",
      "/settings",
    ])
  })

  // Each route mounted with no params, as a stray link would reach it,
  // against a server that answers every list empty. What renders proves the
  // path is wired to the page meant for it: each expected text belongs to
  // that page alone.
  it("mounts the right page on each route", async () => {
    const answers = {
      "endpoints.list": { endpoints: [] },
      "deliveries.list": { deliveries: [], complete: true },
      "events.list": { events: [], complete: true },
      "dlq.list": { entries: [], complete: true },
      "eventTypes.list": { types: [] },
      "overview.stats": {
        eventTypes: 0,
        endpoints: 0,
        pending: 0,
        deadLetters: 0,
      },
      "settings.config": {
        concurrency: 1,
        batchSize: 1,
        maxRetries: 5,
        pollIntervalMs: 1000,
        maxPollIntervalMs: 30000,
        requestTimeoutMs: 10000,
        shutdownTimeoutMs: 1000,
        cacheTtlMs: 1000,
        retryScheduleMs: [5000],
      },
    }
    const expected: Record<string, string | RegExp> = {
      "/": "No failed deliveries.",
      "/deliveries": /Nothing has been sent yet/,
      "/deliveries/:id": "No delivery selected.",
      "/events": "No events yet. Send one to see it fan out.",
      "/events/send": "Send an event",
      "/events/:id": "No event selected.",
      "/dlq": /The dead letter queue is empty/,
      "/dlq/:id": "No dead letter selected.",
      "/endpoints":
        "No endpoints yet. Create one to start delivering webhooks.",
      "/endpoints/new": "New endpoint",
      "/endpoints/:id": "No endpoint selected.",
      "/event-types":
        "No event types yet. Register one before sending events of it.",
      "/event-types/new": "Register an event type",
      "/event-types/:name": "No event type selected.",
      "/settings": "Attempts per delivery",
    }
    for (const route of relayPlugin.routes) {
      const { unmount } = renderPage(route.element, stubClient(answers))
      expect(
        await screen.findByText(expected[route.path]),
        route.path
      ).toBeDefined()
      unmount()
    }
  })

  it("groups its nav into traffic and configuration", () => {
    expect(relayPlugin.nav?.map((n) => [n.group, n.label, n.to])).toEqual([
      ["Overview", "Overview", "/"],
      ["Traffic", "Deliveries", "/deliveries"],
      ["Traffic", "Events", "/events"],
      ["Traffic", "Dead letters", "/dlq"],
      ["Configuration", "Endpoints", "/endpoints"],
      ["Configuration", "Event types", "/event-types"],
      ["Configuration", "Settings", "/settings"],
    ])
  })
})
