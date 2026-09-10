import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { passwordSubPlugin } from "../../src/sub/password"
import { renderSubPage, subStubClient } from "./harness"

const page = passwordSubPlugin.routes[0].element

describe("password policy", () => {
  it("shows the policy from its own contributor and the panel from the host", async () => {
    const own = subStubClient({
      "password.policy": { minLength: 12, requireSpecial: true, hashAlgorithm: "argon2id" },
    })
    const host = subStubClient({
      "settings.namespace": {
        namespace: "password",
        scope: "app",
        categories: [
          {
            name: "Strength",
            settings: [
              {
                key: "min_length",
                displayName: "Minimum length",
                type: "int",
                effectiveValue: 12,
                isOverridden: true,
                isEnforced: false,
                canOverride: true,
                order: 1,
              },
            ],
          },
        ],
      },
    })
    renderSubPage(page, {
      client: own.client,
      hostClient: host.client,
      allowed: passwordSubPlugin.hostIntents,
    })

    await waitFor(() => expect(screen.getByText("argon2id")).toBeTruthy())
    // Two clients on one page: password.policy is this sub-plugin's own, and
    // settings.namespace belongs to auth and is reached through hostIntents.
    expect(own.intents).toEqual(["password.policy"])
    expect(host.intents).toEqual(["settings.namespace"])
    // This is the settings form's own field label, distinct from the page's
    // own "Minimum password length" summary term above it -- two clients,
    // two different pieces of UI, both on screen at once.
    await waitFor(() => expect(screen.getByText("Minimum length")).toBeTruthy())
  })

  it("labels the hash algorithm as compiled rather than as a live reading", async () => {
    const own = subStubClient({
      "password.policy": { minLength: 12, requireSpecial: true, hashAlgorithm: "argon2id" },
    })
    renderSubPage(page, {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: passwordSubPlugin.hostIntents,
    })
    await waitFor(() => expect(screen.getByText("argon2id")).toBeTruthy())
    // The server hardcodes this and never reads engine config. Presenting a
    // constant as a live reading is how somebody ends up deciding on it.
    expect(screen.getByText(/as compiled/i)).toBeTruthy()
  })

  it("says engine default rather than zero when no minimum is set", async () => {
    const own = subStubClient({
      "password.policy": { minLength: 0, requireSpecial: false, hashAlgorithm: "argon2id" },
    })
    renderSubPage(page, {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: passwordSubPlugin.hostIntents,
    })
    // "0 characters" reads as a policy allowing empty passwords. It is not one.
    await waitFor(() => expect(screen.getByText(/engine default/i)).toBeTruthy())
  })
})
