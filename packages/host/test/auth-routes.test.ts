import { describe, expect, it } from "vitest"
import type { AuthIntents } from "@forge-go/dashboard-plugin"
import { authRoutesFor, AUTH_PATHS, isAuthPath } from "../src/auth/routes"

const minimal: AuthIntents = { config: "auth.config", signIn: "auth.login" }

const Stub = () => null
const defaults = {
  signIn: Stub,
  forgotPassword: Stub,
  resetPassword: Stub,
  signUp: Stub,
  setup: Stub,
}

describe("authRoutesFor", () => {
  it("always mounts login, and nothing else for a minimal provider", () => {
    expect(authRoutesFor(minimal, {}, defaults).map((r) => r.path)).toEqual(["/login"])
  })

  it("mounts forgot-password only when the intent is declared", () => {
    const routes = authRoutesFor({ ...minimal, forgotPassword: "auth.forgot" }, {}, defaults)
    expect(routes.map((r) => r.path)).toContain("/forgot-password")
  })

  it("mounts reset-password only when the intent is declared", () => {
    const routes = authRoutesFor({ ...minimal, resetPassword: "auth.reset" }, {}, defaults)
    expect(routes.map((r) => r.path)).toContain("/reset-password")
  })

  it("mounts signup only when the intent is declared", () => {
    expect(authRoutesFor({ ...minimal, signUp: "auth.signup" }, {}, defaults).map((r) => r.path))
      .toContain("/signup")
  })

  it("mounts setup only when both setup intents are declared", () => {
    expect(authRoutesFor({ ...minimal, setupStatus: "auth.setupStatus" }, {}, defaults).map((r) => r.path))
      .not.toContain("/setup")
    const both = authRoutesFor(
      { ...minimal, setupStatus: "auth.setupStatus", completeSetup: "auth.setup" },
      {},
      defaults,
    )
    expect(both.map((r) => r.path)).toContain("/setup")
  })

  it("prefers an overriding screen over the default", () => {
    const Custom = () => null
    expect(authRoutesFor(minimal, { signIn: Custom }, defaults)[0].element).toBe(Custom)
  })
})

describe("isAuthPath", () => {
  it("matches a mounted auth path under the basename", () => {
    expect(isAuthPath("/forge/login", "/forge")).toBe(true)
    expect(isAuthPath("/forge/reset-password", "/forge")).toBe(true)
  })

  it("does not match a dashboard path", () => {
    expect(isAuthPath("/forge/apps", "/forge")).toBe(false)
    expect(isAuthPath("/forge", "/forge")).toBe(false)
  })

  it("does not match a path that merely starts with an auth path", () => {
    expect(isAuthPath("/forge/loginsomething", "/forge")).toBe(false)
  })

  it("works with no basename", () => {
    expect(isAuthPath("/login", "")).toBe(true)
  })

  it("exposes every known path", () => {
    expect(AUTH_PATHS).toEqual([
      "/login",
      "/forgot-password",
      "/reset-password",
      "/signup",
      "/setup",
    ])
  })

  it("tolerates a trailing slash on the basename", () => {
    expect(isAuthPath("/forge/login", "/forge/")).toBe(true)
  })

  it("treats a bare slash basename as no basename", () => {
    expect(isAuthPath("/login", "/")).toBe(true)
  })

  it("tolerates a trailing slash on the pathname", () => {
    expect(isAuthPath("/forge/login/", "/forge")).toBe(true)
  })

  it("does not match a path outside the basename", () => {
    expect(isAuthPath("/login", "/forge")).toBe(false)
  })

  it("still rejects prefix confusion", () => {
    expect(isAuthPath("/forge/loginsomething", "/forge")).toBe(false)
    expect(isAuthPath("/forge/login/extra", "/forge")).toBe(false)
  })
})
