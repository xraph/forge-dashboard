import { describe, expect, it } from "vitest"
import { authsomeSubPlugins } from "../../src/sub"

describe("authsomeSubPlugins", () => {
  it("is all twenty-four", () => {
    expect(authsomeSubPlugins).toHaveLength(24)
  })

  it("declares every route exactly once across the whole set", () => {
    const paths = authsomeSubPlugins.flatMap((s) => s.routes.map((r) => r.path))
    const duplicates = paths.filter((p, i) => paths.indexOf(p) !== i)
    // Two sub-plugins claiming one path is decided by the host's collision
    // rule, which drops one of them along with its nav entry. That is a
    // correct recovery from a mistake, not a design, and it should never fire
    // for first-party plugins.
    expect(duplicates).toEqual([])
  })

  it("declares every nav target exactly once", () => {
    const targets = authsomeSubPlugins.flatMap((s) => s.nav.map((n) => n.to))
    const duplicates = targets.filter((t, i) => targets.indexOf(t) !== i)
    expect(duplicates).toEqual([])
  })

  it("mounts every one inside auth", () => {
    for (const sub of authsomeSubPlugins) expect(sub.host).toBe("auth")
  })

  it("gives every nav item a route to land on", () => {
    for (const sub of authsomeSubPlugins) {
      const paths = new Set(sub.routes.map((r) => r.path))
      for (const item of sub.nav) {
        // A nav entry pointing at a path nobody declared is a link to the
        // host's fallback, and it looks exactly like a broken page.
        expect(paths.has(item.to)).toBe(true)
      }
    }
  })

  it("declares host intents only where a sub-plugin actually reads the host", () => {
    for (const sub of authsomeSubPlugins) {
      for (const intent of sub.hostIntents) {
        // The allowlist is the whole scoping guarantee. Anything outside the
        // settings four is a sub-plugin reaching into auth for something else.
        expect(intent.startsWith("settings.")).toBe(true)
      }
    }
  })

  it("uses a slot name the platform knows for every contribution", () => {
    const known = new Set([
      "overview.widgets",
      "user.detail.sections",
      "org.detail.sections",
      "org.detail.tabs",
      "org.create.fields",
      "settings.tabs",
    ])
    for (const sub of authsomeSubPlugins) {
      for (const slot of Object.keys(sub.contributions)) {
        // defineSubPlugin already throws on an unknown slot at import time.
        // This asserts the set itself has not drifted from the platform's.
        expect(known.has(slot)).toBe(true)
      }
    }
  })
})
