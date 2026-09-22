import { describe, expect, it } from "vitest"
import { resolveAuthProvider } from "../src/auth"
import type { AuthIntents } from "../src/auth"
import type { ForgePlugin } from "../src/types"

function plugin(extension: string, intents?: AuthIntents): ForgePlugin {
  return {
    extension,
    nav: [],
    routes: [],
    context: [],
    ...(intents ? { auth: { intents } } : {}),
  } as ForgePlugin
}

const minimal: AuthIntents = { config: "auth.config", signIn: "auth.login" }

describe("PluginAuth", () => {
  it("carries intent names and no components", () => {
    const provider = plugin("auth", minimal)
    expect(provider.auth?.intents.signIn).toBe("auth.login")
    expect("gate" in (provider.auth ?? {})).toBe(false)
  })

  it("finds the one plugin declaring auth", () => {
    expect(resolveAuthProvider([plugin("core"), plugin("auth", minimal)])?.extension).toBe("auth")
  })

  it("returns undefined when nothing declares auth", () => {
    expect(resolveAuthProvider([plugin("core")])).toBeUndefined()
  })

  it("throws when two plugins declare auth, naming both", () => {
    expect(() => resolveAuthProvider([plugin("a", minimal), plugin("b", minimal)])).toThrow(/a, b/)
  })
})
