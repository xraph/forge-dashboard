import { describe, expect, it } from "vitest"
import { defineForgeDashboard } from "../src/define"

const plugin = {
  extension: "core-contract",
  routes: [{ path: "/", element: () => null }],
} as never

describe("defineForgeDashboard", () => {
  it("derives the api path from the mount path", () => {
    const forge = defineForgeDashboard({ mountPath: "/forge", plugins: [] })
    expect(forge.apiPath).toBe("/api/forge")
  })

  it("points the contract at the api path and the shell at the mount path", () => {
    // These two must not be confused. basePath prefixes the Go contract, which
    // a Next app serves through its own route handler; shellBase is the page's
    // own URL. Deriving both from one value is the point of this function.
    const forge = defineForgeDashboard({ mountPath: "/admin", plugins: [] })
    expect(forge.config.basePath).toBe("/api/admin")
    expect(forge.config.shellBase).toBe("/admin")
  })

  it("accepts an explicit api path", () => {
    const forge = defineForgeDashboard({
      mountPath: "/forge",
      apiPath: "/api/forge-contract",
      plugins: [],
    })
    expect(forge.apiPath).toBe("/api/forge-contract")
    expect(forge.config.basePath).toBe("/api/forge-contract")
  })

  it("carries plugins and sub-plugins through untouched", () => {
    const forge = defineForgeDashboard({ mountPath: "/forge", plugins: [plugin] })
    expect(forge.plugins).toEqual([plugin])
  })

  it("returns the same object shape on repeated calls with equal input", () => {
    // ForgeDashboardProvider memoizes on config identity, so the object has to
    // be built once at module scope, not per render. This only documents that
    // the function is pure; holding it at module scope is the caller's job.
    const a = defineForgeDashboard({ mountPath: "/forge", plugins: [] })
    const b = defineForgeDashboard({ mountPath: "/forge", plugins: [] })
    expect(a.config).toEqual(b.config)
    expect(a.config).not.toBe(b.config)
  })

  describe("validation, at import time rather than at render", () => {
    it("rejects a mount path that is not absolute", () => {
      expect(() =>
        defineForgeDashboard({ mountPath: "forge", plugins: [] })
      ).toThrow(/mountPath/)
    })

    it("rejects a trailing slash, which doubles up when paths are joined", () => {
      expect(() =>
        defineForgeDashboard({ mountPath: "/forge/", plugins: [] })
      ).toThrow(/mountPath/)
    })

    it("rejects an api path that is not absolute", () => {
      expect(() =>
        defineForgeDashboard({
          mountPath: "/forge",
          apiPath: "api/forge",
          plugins: [],
        })
      ).toThrow(/apiPath/)
    })

    it("rejects an api path equal to the mount path", () => {
      expect(() =>
        defineForgeDashboard({
          mountPath: "/forge",
          apiPath: "/forge",
          plugins: [],
        })
      ).toThrow(/apiPath/)
    })

    it("rejects an api path nested under the mount path", () => {
      // The page is an optional catch-all. Putting the contract underneath it
      // means every contract URL is also a page URL, which the client router
      // will try to match.
      expect(() =>
        defineForgeDashboard({
          mountPath: "/forge",
          apiPath: "/forge/api",
          plugins: [],
        })
      ).toThrow(/apiPath/)
    })
  })
})
