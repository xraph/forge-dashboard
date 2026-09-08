import { describe, expect, it } from "vitest"
import { defineSubPlugin } from "../src/subplugin"

const Noop = () => null

function valid() {
  return {
    extension: "organization",
    host: "auth",
    label: "Organizations",
    nav: [{ label: "Organizations", to: "/organizations", group: "Identity" }],
    routes: [{ path: "/organizations", element: Noop }],
  }
}

describe("defineSubPlugin", () => {
  it("returns the sub-plugin with empty defaults filled in", () => {
    const sub = defineSubPlugin(valid())
    expect(sub.extension).toBe("organization")
    expect(sub.host).toBe("auth")
    expect(sub.contributions).toEqual({})
    expect(sub.hostIntents).toEqual([])
  })

  it("requires an extension naming its own Go contributor", () => {
    expect(() => defineSubPlugin({ ...valid(), extension: "" })).toThrow(/extension/)
  })

  it("requires a host naming the plugin it mounts inside", () => {
    expect(() => defineSubPlugin({ ...valid(), host: "" })).toThrow(/host/)
  })

  it("refuses a sub-plugin that hosts itself, which would recurse forever", () => {
    expect(() => defineSubPlugin({ ...valid(), host: "organization" })).toThrow(/itself/)
  })

  it("requires nav paths to be scope-relative", () => {
    expect(() =>
      defineSubPlugin({
        ...valid(),
        nav: [{ label: "Orgs", to: "organizations" }],
      }),
    ).toThrow(/must start with/)
  })

  it("requires route paths to be scope-relative", () => {
    expect(() =>
      defineSubPlugin({ ...valid(), routes: [{ path: "organizations", element: Noop }] }),
    ).toThrow(/must start with/)
  })

  it("rejects an unknown slot name rather than silently never rendering it", () => {
    expect(() =>
      defineSubPlugin({
        ...valid(),
        // A typo here is otherwise invisible: PluginSlot would just never find it.
        contributions: { "user.details.sections": [{ id: "x", render: Noop }] },
      } as never),
    ).toThrow(/unknown slot/)
  })

  it("rejects two contributions to one slot sharing an id", () => {
    expect(() =>
      defineSubPlugin({
        ...valid(),
        contributions: {
          "overview.widgets": [
            { id: "count", render: Noop },
            { id: "count", render: Noop },
          ],
        },
      }),
    ).toThrow(/both use the id/)
  })

  it("accepts every known slot name", () => {
    const sub = defineSubPlugin({
      ...valid(),
      contributions: {
        "overview.widgets": [{ id: "a", render: Noop }],
        "user.detail.sections": [{ id: "b", render: Noop }],
        "org.detail.sections": [{ id: "c", render: Noop }],
        "org.detail.tabs": [{ id: "d", label: "Billing", render: Noop }],
        "org.create.fields": [{ id: "e", render: Noop }],
        "settings.tabs": [{ id: "f", render: Noop }],
      },
    })
    expect(Object.keys(sub.contributions)).toHaveLength(6)
  })

  it("keeps a declared hostIntents allowlist", () => {
    const sub = defineSubPlugin({ ...valid(), hostIntents: ["settings.namespace"] })
    expect(sub.hostIntents).toEqual(["settings.namespace"])
  })

  it("rejects two sibling nav items pointing at the same place", () => {
    expect(() =>
      defineSubPlugin({
        ...valid(),
        nav: [
          { label: "Organizations", to: "/organizations" },
          { label: "Orgs", to: "/organizations" },
        ],
      }),
    ).toThrow(/both point at/)
  })

  it("allows a child to repeat a path used under a different parent", () => {
    expect(() =>
      defineSubPlugin({
        ...valid(),
        nav: [
          { label: "A", to: "/a", children: [{ label: "List", to: "/a/list" }] },
          { label: "B", to: "/b", children: [{ label: "List", to: "/a/list" }] },
        ],
      }),
    ).not.toThrow()
  })
})
