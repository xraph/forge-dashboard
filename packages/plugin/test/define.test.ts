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

// Whole-branch review, Important-adjacent Minor. Nothing structurally stops a
// root plugin from declaring a path under the "/@" sigil: mountPath passes a
// root plugin's paths straight through, so `routes: [{ path: "/@streaming/rooms" }]`
// mounts exactly there and can collide with a real scoped plugin's own mount.
// Before namespacing, two plugins landing on the same pathname was
// structurally impossible; these guards restore that guarantee for root
// plugins specifically, since only they can opt out of namespacing at all.
describe("definePlugin root plugins may not claim a scoped path", () => {
  it("rejects a root plugin whose nav item starts with the sigil", () => {
    expect(() =>
      definePlugin({
        extension: "core-contract",
        root: true,
        nav: [{ label: "Rooms", to: "/@streaming/rooms" }],
        routes: [],
      }),
    ).toThrow(/@streaming\/rooms/)
  })

  it("rejects a root plugin whose nested nav child starts with the sigil", () => {
    expect(() =>
      definePlugin({
        extension: "core-contract",
        root: true,
        nav: [
          {
            label: "Overview",
            to: "/overview",
            children: [{ label: "Rooms", to: "/@streaming/rooms" }],
          },
        ],
        routes: [],
      }),
    ).toThrow(/@streaming\/rooms/)
  })

  it("rejects a root plugin whose route path starts with the sigil", () => {
    expect(() =>
      definePlugin({
        extension: "core-contract",
        root: true,
        routes: [{ path: "/@streaming/rooms", element: Stub }],
      }),
    ).toThrow(/@streaming\/rooms/)
  })

  it("names the offending plugin in the error", () => {
    expect(() =>
      definePlugin({
        extension: "core-contract",
        root: true,
        nav: [{ label: "Rooms", to: "/@streaming/rooms" }],
        routes: [],
      }),
    ).toThrow(/core-contract/)
  })

  it("accepts a root plugin whose nav and routes stay off the sigil", () => {
    expect(() =>
      definePlugin({
        extension: "core-contract",
        root: true,
        nav: [{ label: "Overview", to: "/overview" }],
        routes: [{ path: "/overview", element: Stub }],
      }),
    ).not.toThrow()
  })

  // The sigil guard is a root-only rule. A namespaced plugin's own `to` and
  // `path` values are scope-relative -- scopePath prepends its namespace on
  // top of whatever is written here -- so this guard has nothing to say
  // about them, however unusual the literal string looks.
  it("leaves a non-root plugin's sigil-shaped paths alone", () => {
    expect(() =>
      definePlugin({
        extension: "streaming-contract",
        nav: [{ label: "Odd", to: "/@nested/odd" }],
        routes: [{ path: "/@nested/odd", element: Stub }],
      }),
    ).not.toThrow()
  })
})

// Duplicates are rejected per sibling array, which is the scope React keys
// against. Two entries in one list collide; a child repeating an ancestor's
// `to`, or two children under different parents, never share a key scope.
describe("definePlugin duplicate nav destinations", () => {
  it("refuses two top-level nav items sharing a `to`", () => {
    expect(() =>
      definePlugin({
        extension: "streaming-contract",
        nav: [
          { label: "Rooms", to: "/rooms" },
          { label: "Live rooms", to: "/rooms" },
        ],
        routes: [],
      }),
    ).toThrow(/\/rooms/)
  })

  it("refuses two children of one parent sharing a `to`", () => {
    expect(() =>
      definePlugin({
        extension: "streaming-contract",
        nav: [
          {
            label: "Archive",
            to: "/archive",
            children: [
              { label: "Recent", to: "/archive/all" },
              { label: "Everything", to: "/archive/all" },
            ],
          },
        ],
        routes: [],
      }),
    ).toThrow(/\/archive\/all/)
  })

  it("names the offending plugin in the error", () => {
    expect(() =>
      definePlugin({
        extension: "streaming-contract",
        nav: [
          { label: "Rooms", to: "/rooms" },
          { label: "Live rooms", to: "/rooms" },
        ],
        routes: [],
      }),
    ).toThrow(/streaming-contract/)
  })

  it("accepts a child repeating its own parent's `to`", () => {
    expect(() =>
      definePlugin({
        extension: "streaming-contract",
        nav: [
          {
            label: "Rooms",
            to: "/rooms",
            children: [{ label: "All rooms", to: "/rooms" }],
          },
        ],
        routes: [],
      }),
    ).not.toThrow()
  })

  it("accepts the same `to` under two different parents", () => {
    expect(() =>
      definePlugin({
        extension: "streaming-contract",
        nav: [
          {
            label: "Rooms",
            to: "/rooms",
            children: [{ label: "Recent", to: "/recent" }],
          },
          {
            label: "Archive",
            to: "/archive",
            children: [{ label: "Recent", to: "/recent" }],
          },
        ],
        routes: [],
      }),
    ).not.toThrow()
  })
})
