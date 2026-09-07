import { describe, expect, it } from "vitest"
import { definePlugin } from "../src/define"
import {
  namespaceOf,
  labelOf,
  resolveActiveScope,
  scopePath,
} from "../src/scope"
import type { Scope } from "../src/scope"

function scope(extension: string, namespace?: string): Scope {
  const plugin = definePlugin({ extension, namespace, routes: [] })
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

  it("falls back to the first scope when the namespace is unknown", () => {
    expect(resolveActiveScope("/@nope/x", scopes)!.id).toBe("core-contract")
  })

  it("falls back to the first scope when there is no sigil", () => {
    expect(resolveActiveScope("/users", scopes)!.id).toBe("core-contract")
  })

  it("falls back to the first scope at the root", () => {
    expect(resolveActiveScope("/", scopes)!.id).toBe("core-contract")
  })

  it("returns undefined when there are no scopes", () => {
    expect(resolveActiveScope("/@auth/users", [])).toBeUndefined()
  })
})
