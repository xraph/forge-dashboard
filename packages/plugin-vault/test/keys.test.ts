import { describe, expect, it } from "vitest"
import { configPath, flagPath, rotationPath, secretPath } from "../src/keys"

describe("secretPath", () => {
  it("encodes a slash so the key stays one route segment", () => {
    expect(secretPath("db/primary.password")).toBe(
      "/secrets/db%2Fprimary.password"
    )
    expect(decodeURIComponent(secretPath("db/primary.password").slice(9))).toBe(
      "db/primary.password"
    )
  })

  it("leaves a plain key unchanged", () => {
    expect(secretPath("apikey")).toBe("/secrets/apikey")
  })
})

describe("rotationPath", () => {
  it("encodes a slash and leaves a plain key unchanged", () => {
    expect(rotationPath("db/primary.password")).toBe(
      "/rotation/db%2Fprimary.password"
    )
    expect(rotationPath("apikey")).toBe("/rotation/apikey")
  })
})

describe("flagPath", () => {
  it("encodes a slash so the key stays one route segment", () => {
    expect(flagPath("checkout/new-flow")).toBe("/flags/checkout%2Fnew-flow")
    expect(flagPath("a b?c#d")).toBe("/flags/a%20b%3Fc%23d")
  })

  it("leaves a plain key unchanged", () => {
    expect(flagPath("dark-mode")).toBe("/flags/dark-mode")
  })
})

describe("configPath", () => {
  it("encodes a slash so the key stays one route segment", () => {
    expect(configPath("app/http.timeout")).toBe("/config/app%2Fhttp.timeout")
    expect(configPath("a b?c#d")).toBe("/config/a%20b%3Fc%23d")
  })

  it("leaves a plain key unchanged", () => {
    expect(configPath("timeout")).toBe("/config/timeout")
  })
})
