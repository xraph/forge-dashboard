import { describe, expect, it } from "vitest"
import { definePlugin } from "../src/define"
import { resolveAuthProvider } from "../src/auth"

const Gate = () => null

function plugin(extension: string, withGate: boolean) {
  return definePlugin({
    extension,
    namespace: extension,
    nav: [],
    routes: [],
    ...(withGate ? { auth: { gate: Gate } } : {}),
  })
}

describe("resolveAuthProvider", () => {
  it("returns undefined when no plugin declares a gate", () => {
    expect(resolveAuthProvider([plugin("core", false), plugin("streaming", false)])).toBeUndefined()
  })

  it("returns the one plugin that declares a gate", () => {
    const found = resolveAuthProvider([plugin("core", false), plugin("auth", true)])
    expect(found?.extension).toBe("auth")
  })

  it("throws when two plugins declare a gate", () => {
    // Silently picking the first would make which gate you get depend on the
    // order the host was handed its plugins, and the person seeing the wrong
    // sign-in screen would have nothing to go on. This is a wiring bug in the
    // host application, so it fails loudly at resolve time.
    expect(() => resolveAuthProvider([plugin("auth", true), plugin("other", true)])).toThrow(
      /auth.*other|other.*auth/,
    )
  })

  it("names both offenders in the error", () => {
    expect(() => resolveAuthProvider([plugin("auth", true), plugin("other", true)])).toThrow(
      /declares an auth gate/,
    )
  })

  it("accepts an empty plugin list", () => {
    expect(resolveAuthProvider([])).toBeUndefined()
  })

  it("carries the provider's signOutIntent through", () => {
    const withSignOut = definePlugin({
      extension: "auth",
      namespace: "auth",
      nav: [],
      routes: [],
      auth: { gate: Gate, signOutIntent: "auth.logout" },
    })
    expect(resolveAuthProvider([withSignOut])?.auth?.signOutIntent).toBe("auth.logout")
  })
})
