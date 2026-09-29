import { describe, expect, it } from "vitest"
import { rotationPath, secretPath } from "../src/keys"

describe("secretPath", () => {
  it("encodes a slash so the key stays one route segment", () => {
    expect(secretPath("db/primary.password")).toBe(
      "/secrets/db%2Fprimary.password",
    )
    expect(decodeURIComponent(secretPath("db/primary.password").slice(9))).toBe(
      "db/primary.password",
    )
  })

  it("leaves a plain key unchanged", () => {
    expect(secretPath("apikey")).toBe("/secrets/apikey")
  })
})

describe("rotationPath", () => {
  it("encodes a slash and leaves a plain key unchanged", () => {
    expect(rotationPath("db/primary.password")).toBe(
      "/rotation/db%2Fprimary.password",
    )
    expect(rotationPath("apikey")).toBe("/rotation/apikey")
  })
})
