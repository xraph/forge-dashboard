import { describe, expect, it } from "vitest"
import type { AuthConfig, SocialProvider } from "../src/auth"

describe("AuthConfig", () => {
  it("requires passwordEnabled and leaves everything else optional", () => {
    // A config answering only passwordEnabled is valid. That asymmetry is the
    // point: a deployment with password login off and one OAuth provider must
    // not be shown a box it will reject.
    const minimal: AuthConfig = { passwordEnabled: false }
    expect(minimal.passwordEnabled).toBe(false)

    const provider: SocialProvider = {
      id: "github",
      label: "Continue with GitHub",
      authStartURL: "https://auth.example/start/github",
    }
    const full: AuthConfig = {
      passwordEnabled: true,
      brand: "Platform",
      signupURL: "/signup",
      signupLabel: "Create an account",
      termsURL: "https://example/terms",
      privacyURL: "https://example/privacy",
      socialProviders: [provider],
    }
    expect(full.socialProviders).toHaveLength(1)
  })
})
