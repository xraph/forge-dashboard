import { describe, expect, it } from "vitest"
import { mountPath, routedPathDimension, scopePath, urlValueOf } from "../src/scope"
import { definePlugin } from "../src/define"
import type { ContextDimension } from "../src/types"

const appDimension: ContextDimension = {
  id: "app",
  label: "App",
  query: "apps.context",
  switchCommand: "apps.switch",
  select: () => ({ options: [] }),
  payload: (appId) => ({ appId }),
  routed: { placement: "path", param: "app", by: "slug" },
}

const envDimension: ContextDimension = {
  ...appDimension,
  id: "environment",
  switchCommand: "environments.switch",
  routed: { placement: "query", param: "env", by: "slug" },
}

describe("scopePath with a segment", () => {
  it("behaves exactly as before when there is no segment", () => {
    // Every plugin without a routed dimension keeps the paths it had. That is
    // the property that lets core and streaming stay untouched.
    expect(scopePath("auth", "/users")).toBe("/@auth/users")
    expect(scopePath("auth", "/")).toBe("/@auth")
  })

  it("puts the segment between the namespace and the page", () => {
    expect(scopePath("auth", "/users", "acme")).toBe("/@auth/acme/users")
    expect(scopePath("auth", "/users/:id", "acme")).toBe("/@auth/acme/users/:id")
  })

  it("does not leave a trailing slash on the scope root", () => {
    // "/@auth/acme/" is a different location from "/@auth/acme" to
    // react-router, so a trailing slash here is a page that does not match.
    expect(scopePath("auth", "/", "acme")).toBe("/@auth/acme")
  })

  it("collapses an empty segment rather than emitting a double slash", () => {
    expect(scopePath("auth", "/users", "")).toBe("/@auth/users")
    expect(scopePath("auth", "/users", undefined)).toBe("/@auth/users")
  })
})

describe("mountPath with a segment", () => {
  const scoped = definePlugin({ extension: "auth", routes: [], context: [appDimension] })
  const root = definePlugin({ extension: "core", root: true, routes: [] })

  it("carries the segment through for a scoped plugin", () => {
    expect(mountPath(scoped, "/users", "acme")).toBe("/@auth/acme/users")
  })

  it("leaves a root plugin's paths absolute, segment or not", () => {
    // A root plugin owns "/" and has no namespace to nest under. Inserting a
    // segment here would move the dashboard's own pages.
    expect(mountPath(root, "/overview", "acme")).toBe("/overview")
  })
})

describe("routedPathDimension", () => {
  it("finds the path-routed dimension and ignores a query-routed one", () => {
    const plugin = definePlugin({
      extension: "auth",
      routes: [],
      context: [envDimension, appDimension],
    })
    expect(routedPathDimension(plugin)?.id).toBe("app")
  })

  it("answers undefined for a plugin with no routed dimension at all", () => {
    const plugin = definePlugin({ extension: "streaming", routes: [] })
    expect(routedPathDimension(plugin)).toBeUndefined()
  })
})

describe("urlValueOf", () => {
  it("uses the slug when the dimension asks for one", () => {
    expect(urlValueOf(appDimension, { id: "app_1", label: "Acme", slug: "acme" })).toBe("acme")
  })

  it("uses the id when the dimension asks for one", () => {
    const byId: ContextDimension = {
      ...appDimension,
      routed: { placement: "path", param: "app", by: "id" },
    }
    expect(urlValueOf(byId, { id: "app_1", label: "Acme", slug: "acme" })).toBe("app_1")
  })

  it("falls back to the id rather than putting undefined in a path", () => {
    // A dimension asking for slugs whose options have none is an authoring
    // mistake. An ugly URL is a better way to find that out than a broken one.
    expect(urlValueOf(appDimension, { id: "app_1", label: "Acme" })).toBe("app_1")
  })
})
