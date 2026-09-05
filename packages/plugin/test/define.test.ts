import { describe, expect, it } from "vitest"
import { definePlugin } from "../src/define"

function Stub() {
  return null
}

describe("definePlugin", () => {
  it("returns the plugin it was given", () => {
    const p = definePlugin({
      extension: "authsome",
      routes: [{ path: "/authsome/users", element: Stub }],
    })

    expect(p.extension).toBe("authsome")
    expect(p.routes).toHaveLength(1)
  })

  it("defaults nav to an empty array when omitted", () => {
    const p = definePlugin({ extension: "billing", routes: [] })

    expect(p.nav).toEqual([])
  })

  // The extension name is the join key against the Go contributor. Without it
  // the host cannot resolve capabilities, so a plugin with no name is useless
  // and should say so at import time rather than render nothing at runtime.
  it("refuses a plugin with no extension name", () => {
    expect(() => definePlugin({ extension: "", routes: [] })).toThrow(/extension/i)
  })

  it("refuses a route whose path does not start with a slash", () => {
    expect(() =>
      definePlugin({ extension: "billing", routes: [{ path: "oops", element: Stub }] }),
    ).toThrow(/path/i)
  })

  // requires is optional. Omitting it means the host skips the version check,
  // which is the safe default: you cannot check what was not declared.
  it("leaves requires undefined when omitted", () => {
    const p = definePlugin({ extension: "billing", routes: [] })

    expect(p.requires).toBeUndefined()
  })
})
