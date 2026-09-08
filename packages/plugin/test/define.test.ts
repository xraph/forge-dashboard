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

  it("keeps an explicit namespace", () => {
    const p = definePlugin({
      extension: "streaming-contract",
      namespace: "streaming",
      routes: [{ path: "/rooms", element: Stub }],
    })

    expect(p.namespace).toBe("streaming")
  })

  it("rejects a namespace containing a slash", () => {
    expect(() =>
      definePlugin({
        extension: "auth",
        namespace: "auth/sso",
        routes: [],
      }),
    ).toThrow(/namespace/)
  })

  it("rejects a namespace containing the sigil", () => {
    expect(() =>
      definePlugin({ extension: "auth", namespace: "@auth", routes: [] }),
    ).toThrow(/namespace/)
  })

  it("accepts nav items carrying children", () => {
    const p = definePlugin({
      extension: "streaming-contract",
      nav: [
        {
          label: "Rooms",
          to: "/rooms",
          children: [{ label: "Active", to: "/rooms/active" }],
        },
      ],
      routes: [],
    })

    expect(p.nav[0]!.children).toHaveLength(1)
  })

  it("refuses a nav item whose `to` does not start with a slash", () => {
    expect(() =>
      definePlugin({
        extension: "streaming-contract",
        nav: [{ label: "Rooms", to: "rooms" }],
        routes: [],
      }),
    ).toThrow(/rooms/)
  })

  it("refuses a nested nav child whose `to` does not start with a slash", () => {
    expect(() =>
      definePlugin({
        extension: "streaming-contract",
        nav: [
          {
            label: "Rooms",
            to: "/rooms",
            children: [{ label: "Active", to: "rooms/active" }],
          },
        ],
        routes: [],
      }),
    ).toThrow(/rooms\/active/)
  })

  it("accepts valid nested nav without throwing", () => {
    expect(() =>
      definePlugin({
        extension: "streaming-contract",
        nav: [
          {
            label: "Rooms",
            to: "/rooms",
            children: [
              { label: "Active", to: "/rooms/active" },
              {
                label: "Archived",
                to: "/rooms/archived",
                children: [{ label: "2025", to: "/rooms/archived/2025" }],
              },
            ],
          },
        ],
        routes: [],
      }),
    ).not.toThrow()
  })

  it("accepts a root plugin", () => {
    const p = definePlugin({
      extension: "core-contract",
      root: true,
      nav: [{ label: "Overview", to: "/overview" }],
      routes: [{ path: "/overview", element: Stub }],
    })

    expect(p.root).toBe(true)
    expect(p.namespace).toBeUndefined()
  })

  it("rejects a plugin that sets both root and namespace", () => {
    expect(() =>
      definePlugin({
        extension: "core-contract",
        root: true,
        namespace: "system",
        routes: [],
      }),
    ).toThrow(/root/)
  })

  it("leaves a non-root plugin's root undefined", () => {
    const p = definePlugin({ extension: "auth", routes: [] })

    expect(p.root).toBeUndefined()
  })
})
