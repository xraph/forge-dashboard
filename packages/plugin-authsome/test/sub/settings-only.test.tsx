import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
// NOTE: the package's `exports` map only wildcards "./sub/*.tsx", and this
// module is plain ".ts" (no JSX), so the self-package subpath specifier that
// settings-panel.test.tsx uses does not resolve here. package.json is out of
// scope for this task, so this imports by relative path instead, exactly as
// the plan's Step 1 originally specified.
import { SETTINGS_ONLY, settingsOnlySubPlugins } from "../../src/sub/settings-only"
import { renderSubPage, subStubClient } from "./harness"

/**
 * A minimal, correctly-shaped `Capabilities` payload. `configured: true` by
 * default: this suite is only exercising presence/absence of a contributor,
 * not the setup-vs-ready distinction that `plugin.test.tsx` already covers.
 */
function capabilities(names: string[]): Capabilities {
  return {
    shellEnvelopes: [],
    contributors: names.map((name) => ({ name, envelopes: [], configured: true })),
  }
}

describe("the eighteen settings-only sub-plugins", () => {
  it("declares all eighteen, with unique routes and unique extensions", () => {
    expect(settingsOnlySubPlugins).toHaveLength(18)
    const routes = settingsOnlySubPlugins.flatMap((s) => s.routes.map((r) => r.path))
    expect(new Set(routes).size).toBe(routes.length)
    const extensions = settingsOnlySubPlugins.map((s) => s.extension)
    expect(new Set(extensions).size).toBe(18)
  })

  it("mounts every one inside auth, and never inside itself", () => {
    for (const sub of settingsOnlySubPlugins) {
      expect(sub.host).toBe("auth")
      expect(sub.extension).not.toBe(sub.host)
    }
  })

  it("declares exactly the four settings intents and nothing else", () => {
    for (const sub of settingsOnlySubPlugins) {
      // The allowlist is the entire scoping guarantee for these eighteen. A
      // fifth intent here is a sub-plugin quietly reading users.list through
      // its host.
      expect([...sub.hostIntents].sort()).toEqual([
        "settings.enforce", "settings.namespace", "settings.unenforce", "settings.update",
      ])
    }
  })

  it("renders nothing when its contributor is absent", () => {
    const mfa = settingsOnlySubPlugins.find((s) => s.extension === "mfa")!
    // The gating is presence, not configuration: a deployment without the mfa
    // plugin has no MFA nav entry and no MFA settings tab, which is what an
    // admin expects when a plugin is not installed.
    expect(resolvePluginState(mfa as never, capabilities(["auth"])).kind).toBe("hidden")
    expect(resolvePluginState(mfa as never, capabilities(["auth", "mfa"])).kind).toBe("ready")
  })

  it.each(SETTINGS_ONLY)(
    "$extension renders its own namespace through the host",
    async (row) => {
      // stubClient only records command payloads, not query params, so the
      // namespace actually sent has to be captured by the answer function
      // itself -- see settings-panel.test.tsx for the same pattern.
      let queryParams: unknown
      const host = subStubClient({
        "settings.namespace": (params: unknown) => {
          queryParams = params
          return {
            namespace: row.namespace, scope: "app",
            categories: [{ name: "General", settings: [{
              key: "enabled", displayName: `${row.label} enabled`, type: "bool",
              effectiveValue: true, isOverridden: false, isEnforced: false,
              canOverride: true, order: 1,
            }] }],
          }
        },
      })
      const sub = settingsOnlySubPlugins.find((s) => s.extension === row.extension)!
      const Page = sub.routes[0].element

      renderSubPage(Page, {
        client: subStubClient({}).client,
        hostClient: host.client,
        allowed: sub.hostIntents,
      })

      await waitFor(() => expect(screen.getByText(`${row.label} enabled`)).toBeTruthy())
      // The namespace on the wire is this sub-plugin's own, not the previous
      // row's. A shared component bound to the wrong string is exactly the bug
      // a parameterised suite exists to catch.
      expect(queryParams).toEqual({ namespace: row.namespace, scope: "app" })
    },
  )

  it("contributes one settings tab each, keyed by its own extension", () => {
    for (const sub of settingsOnlySubPlugins) {
      const tabs = sub.contributions["settings.tabs"] ?? []
      expect(tabs).toHaveLength(1)
      expect(tabs[0].id).toBe(sub.extension)
      expect(tabs[0].label).toBeTruthy()
      // The route and the tab must be the SAME component instance. Two
      // instances means two mounts of the same panel and two identical
      // requests, and the second one is invisible.
      expect(tabs[0].render).toBe(sub.routes[0].element)
    }
  })
})
