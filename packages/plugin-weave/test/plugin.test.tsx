import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import weavePlugin, { weavePlugin as named } from "../src/index"

function capabilities(...names: string[]): Capabilities {
  return {
    shellEnvelopes: ["v1"],
    contributors: names.map((name) => ({ name, envelopes: ["v1"], configured: true })),
  }
}

describe("weavePlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(weavePlugin).toBe(named)
  })

  // The join key, checked against what the host does with it rather than
  // compared to itself: weave/extension/contract/manifest.yaml registers the
  // contributor as "weave".
  it("resolves to ready against a host reporting weave's contributor", () => {
    expect(resolvePluginState(weavePlugin, capabilities("weave"))).toEqual({ kind: "ready" })
  })

  it("is hidden when the host does not report weave", () => {
    expect(resolvePluginState(weavePlugin, capabilities("trove")).kind).toBe("hidden")
  })

  it("carries the extension's name as its namespace and label", () => {
    expect(weavePlugin.namespace).toBe("weave")
    expect(weavePlugin.label).toBe("Weave")
  })

  it("puts Overview first in the RAG group at /", () => {
    const overview = weavePlugin.nav?.find((n) => n.label === "Overview")
    expect(overview?.to).toBe("/")
    expect(overview?.group).toBe("RAG")
    expect(weavePlugin.routes.map((r) => r.path)).toContain("/")
  })

  it("puts Pipeline last in the RAG group", () => {
    const pipeline = weavePlugin.nav?.find((n) => n.label === "Pipeline")
    expect(pipeline?.to).toBe("/pipeline")
    expect(pipeline?.group).toBe("RAG")
    expect(pipeline?.priority).toBe(40)
    expect(weavePlugin.routes.map((r) => r.path)).toContain("/pipeline")
  })

  it("puts Collections third in the RAG group", () => {
    const nav = weavePlugin.nav?.find((n) => n.label === "Collections")
    expect(nav?.to).toBe("/collections")
    expect(nav?.priority).toBe(10)
    expect(weavePlugin.routes.map((r) => r.path)).toContain("/collections")
  })
})
