import { describe, expect, it } from "vitest"
import { definePlugin } from "../src/define"
import {
  namespaceOf,
  labelOf,
  resolveActiveScope,
  scopePath,
  mountPath,
  partitionScopes,
} from "../src/scope"
import type { Scope } from "../src/scope"

function scope(extension: string, namespace?: string, root?: boolean): Scope {
  const plugin = definePlugin({ extension, namespace, root, routes: [] })
  return {
    id: plugin.extension,
    namespace: namespaceOf(plugin),
    label: labelOf(plugin),
    plugin,
    state: { kind: "ready" },
  }
}

describe("namespaceOf", () => {
  it("strips a trailing -contract", () => {
    expect(namespaceOf(definePlugin({ extension: "streaming-contract", routes: [] }))).toBe("streaming")
  })

  it("leaves an extension without the suffix alone", () => {
    expect(namespaceOf(definePlugin({ extension: "auth", routes: [] }))).toBe("auth")
  })

  it("prefers an explicit namespace", () => {
    expect(
      namespaceOf(definePlugin({ extension: "core-contract", namespace: "system", routes: [] })),
    ).toBe("system")
  })
})

describe("labelOf", () => {
  it("falls back to the extension", () => {
    expect(labelOf(definePlugin({ extension: "auth", routes: [] }))).toBe("auth")
  })
})

describe("scopePath", () => {
  it("prefixes a relative path with the sigil and namespace", () => {
    expect(scopePath("auth", "/users")).toBe("/@auth/users")
  })

  it("collapses a bare root so the namespace is not doubled by a slash", () => {
    expect(scopePath("streaming", "/")).toBe("/@streaming")
  })

  it("keeps a nested sub-plugin namespace intact", () => {
    expect(scopePath("auth", "/@sso/providers")).toBe("/@auth/@sso/providers")
  })
})

describe("resolveActiveScope", () => {
  const scopes = [scope("core-contract", "system"), scope("streaming-contract"), scope("auth")]

  it("matches the first segment", () => {
    expect(resolveActiveScope("/@auth/users", scopes)!.id).toBe("auth")
  })

  it("matches regardless of how deep the rest of the path runs", () => {
    expect(resolveActiveScope("/@streaming/rooms/active", scopes)!.id).toBe("streaming-contract")
  })

  it("matches a bare namespace with no trailing path", () => {
    expect(resolveActiveScope("/@auth", scopes)!.id).toBe("auth")
  })

  it("resolves a sub-plugin path to its parent scope", () => {
    expect(resolveActiveScope("/@auth/@sso/providers", scopes)!.id).toBe("auth")
  })

  it("returns undefined when the namespace is unknown", () => {
    expect(resolveActiveScope("/@nope/x", scopes)).toBeUndefined()
  })

  it("returns undefined when there is no sigil, meaning the root", () => {
    expect(resolveActiveScope("/users", scopes)).toBeUndefined()
  })

  it("returns undefined at the bare root", () => {
    expect(resolveActiveScope("/", scopes)).toBeUndefined()
  })

  it("returns undefined when there are no scopes", () => {
    expect(resolveActiveScope("/@auth/users", [])).toBeUndefined()
  })
})

describe("mountPath", () => {
  it("serves a root plugin's path unchanged", () => {
    const p = definePlugin({ extension: "core-contract", root: true, routes: [] })
    expect(mountPath(p, "/overview")).toBe("/overview")
  })

  it("serves a root plugin's bare root as /", () => {
    const p = definePlugin({ extension: "core-contract", root: true, routes: [] })
    expect(mountPath(p, "/")).toBe("/")
  })

  it("namespaces a scoped plugin", () => {
    const p = definePlugin({ extension: "streaming-contract", routes: [] })
    expect(mountPath(p, "/rooms")).toBe("/@streaming/rooms")
  })
})

describe("partitionScopes", () => {
  it("separates the root plugin from the scopes", () => {
    const all = [scope("core-contract", undefined, true), scope("auth")]
    const { root, scopes } = partitionScopes(all)

    expect(root!.id).toBe("core-contract")
    expect(scopes.map((s) => s.id)).toEqual(["auth"])
  })

  it("returns no root when none is declared", () => {
    const { root, scopes } = partitionScopes([scope("auth")])

    expect(root).toBeUndefined()
    expect(scopes).toHaveLength(1)
  })

  it("throws when two plugins claim the root", () => {
    expect(() =>
      partitionScopes([scope("core-contract", undefined, true), scope("other", undefined, true)]),
    ).toThrow(/root/)
  })
})
