import { describe, expect, it } from "vitest"
import authsomePlugin from "../src/index"

describe("the authsome plugin's auth declaration", () => {
  it("declares intents and ships no component", () => {
    expect(authsomePlugin.auth?.intents).toEqual({
      config: "auth.config",
      signIn: "auth.login",
      signOut: "auth.logout",
      forgotPassword: "auth.forgotPassword",
      resetPassword: "auth.resetPassword",
      signUp: "auth.signup",
      setupStatus: "auth.setupStatus",
      completeSetup: "auth.setup",
    })
    expect("gate" in (authsomePlugin.auth ?? {})).toBe(false)
  })

  it("still declares no /login route, because the host owns that now", () => {
    expect(authsomePlugin.routes.map((r) => r.path)).not.toContain("/login")
  })
})
