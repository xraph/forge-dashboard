import { describe, expect, it } from "vitest"
import type { CompleteSetupInput, SetupStatus } from "../src/auth"

describe("setup auth contract", () => {
  it("keeps minimal providers and old completion payloads valid", () => {
    const status: SetupStatus = { pending: true }
    const input: CompleteSetupInput = {
      email: "owner@example.com",
      password: "secret",
    }

    expect(status.pending).toBe(true)
    expect(input.email).toBe("owner@example.com")
  })

  it("carries safe platform and environment defaults", () => {
    const status: SetupStatus = {
      pending: true,
      platform: { name: "TwinOS Office", slug: "twinos-office" },
      environment: {
        name: "Development",
        slug: "development",
        type: "development",
        isDefault: true,
      },
    }

    expect(status.environment?.type).toBe("development")
  })
})
