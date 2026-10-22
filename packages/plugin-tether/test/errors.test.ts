import { describe, expect, it } from "vitest"
import { explainError } from "../src/errors"

describe("explainError", () => {
  it("leaves nothing alone", () => {
    expect(explainError(undefined)).toBeUndefined()
  })

  it("tells a signed-out operator to sign in", () => {
    const out = explainError({
      code: "UNAUTHENTICATED",
      message: "authentication required",
    })
    expect(out.code).toBe("UNAUTHENTICATED")
    expect(out.message).toMatch(/sign in/i)
  })

  it("names the stopped broker", () => {
    const out = explainError({ code: "UNAVAILABLE", message: "broker is down" })
    expect(out.message).toMatch(/broker is not running/i)
  })

  it("lists what a permission refusal can mean, and keeps the server's words", () => {
    const out = explainError({
      code: "PERMISSION_DENIED",
      message: "tenant is disabled",
    })
    expect(out.code).toBe("PERMISSION_DENIED")
    expect(out.message).toContain("tenant is disabled")
    expect(out.message).toMatch(/disabled/i)
    expect(out.message).toMatch(/authorized/i)
  })

  it("passes any other code through untouched", () => {
    const err = { code: "CONFLICT", message: "device still has roles" }
    expect(explainError(err)).toBe(err)
  })
})
