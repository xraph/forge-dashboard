import { describe, expect, it } from "vitest"
import { definePlugin } from "../src/define"
import { resolveAuthProvider } from "../src/auth"

function plugin(extension: string, withAuth: boolean) {
  return definePlugin({
    extension,
    namespace: extension,
    nav: [],
    routes: [],
    ...(withAuth
      ? { auth: { intents: { config: "auth.config", signIn: "auth.login" } } }
      : {}),
  })
}

describe("resolveAuthProvider", () => {
  it("returns undefined when no plugin declares auth intents", () => {
    expect(resolveAuthProvider([plugin("core", false), plugin("streaming", false)])).toBeUndefined()
  })

  it("returns the one plugin that declares auth intents", () => {
    const found = resolveAuthProvider([plugin("core", false), plugin("auth", true)])
    expect(found?.extension).toBe("auth")
  })

  it("throws when two plugins declare auth intents", () => {
    // Silently picking the first would make which intents you get depend on the
    // order the host was handed its plugins, and the person seeing the wrong
    // sign-in screen would have nothing to go on. This is a wiring bug in the
    // host application, so it fails loudly at resolve time.
    expect(() => resolveAuthProvider([plugin("auth", true), plugin("other", true)])).toThrow(
      /auth.*other|other.*auth/,
    )
  })

  it("names both offenders in the error", () => {
    expect(() => resolveAuthProvider([plugin("auth", true), plugin("other", true)])).toThrow(
      /declares auth intents/,
    )
  })

  it("accepts an empty plugin list", () => {
    expect(resolveAuthProvider([])).toBeUndefined()
  })

  it("carries the provider's signOut intent through", () => {
    const withSignOut = definePlugin({
      extension: "auth",
      namespace: "auth",
      nav: [],
      routes: [],
      auth: { intents: { config: "auth.config", signIn: "auth.login", signOut: "auth.logout" } },
    })
    expect(resolveAuthProvider([withSignOut])?.auth?.intents.signOut).toBe("auth.logout")
  })
})
