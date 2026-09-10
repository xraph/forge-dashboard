import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { recordingCommandClient, renderPage, stubClient } from "./harness"
import { AuthFeaturesPage } from "../src/pages/features"
import { AuthPluginsPage } from "../src/pages/plugins"

// jsdom 25 ships no PointerEvent constructor at all. The kit Switch's click
// handler re-dispatches the click it receives as a `new PointerEvent(...)` at
// its hidden input, purely to carry the modifier keys along, so a MouseEvent
// satisfies every property that call actually reads. Without this, clicking
// a switch on this page throws "PointerEvent is not a constructor" before
// this file's own assertions ever run. Scoped to this file, matching
// packages/plugin-authsome/test/user-detail.test.tsx.
if (typeof window.PointerEvent === "undefined") {
  // @ts-expect-error - MouseEvent covers every field dispatchClickWithModifiers reads.
  window.PointerEvent = window.MouseEvent
}

const toggles = {
  "auth.featureToggles": {
    toggles: [
      {
        key: "passwordless",
        label: "Passwordless",
        description: "Sign in with an emailed link, no password.",
        enabled: true,
        available: true,
      },
      {
        key: "mfa",
        label: "MFA",
        description: "Requires the mfa plugin, which is not installed.",
        enabled: false,
        available: false,
      },
    ],
  },
}

describe("AuthFeaturesPage", () => {
  it("renders an unavailable row disabled with its reason shown, and an available row enabled", async () => {
    const { client } = stubClient(toggles)
    renderPage(AuthFeaturesPage, client)

    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Passwordless" })).toBeTruthy(),
    )

    // The unavailable row is present - never hidden - and its reason is on
    // screen, not tucked away as a comment only a developer would read.
    const mfaSwitch = screen.getByRole("switch", { name: "MFA" })
    expect(mfaSwitch.getAttribute("aria-disabled")).toBe("true")
    expect(mfaSwitch.getAttribute("aria-checked")).toBe("false")
    expect(
      screen.getByText(/Requires the mfa plugin, which is not installed\./),
    ).toBeTruthy()

    const passwordlessSwitch = screen.getByRole("switch", { name: "Passwordless" })
    expect(passwordlessSwitch.getAttribute("aria-disabled")).toBeNull()
    expect(passwordlessSwitch.getAttribute("aria-checked")).toBe("true")
  })

  it("toggling one row sends auth.toggleFeature for that key alone", async () => {
    const { client, sent } = recordingCommandClient(toggles, {
      "auth.toggleFeature": { ok: true },
    })
    renderPage(AuthFeaturesPage, client)
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Passwordless" })).toBeTruthy(),
    )

    fireEvent.click(screen.getByRole("switch", { name: "Passwordless" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "auth.toggleFeature",
      payload: { key: "passwordless", enabled: false },
    })
  })

  it("leaves the switch showing the server's value when the toggle fails", async () => {
    const { client } = recordingCommandClient(toggles, {
      "auth.toggleFeature": new ContractError("INTERNAL", "could not reach the auth service"),
    })
    renderPage(AuthFeaturesPage, client)
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Passwordless" })).toBeTruthy(),
    )

    const passwordlessSwitch = screen.getByRole("switch", { name: "Passwordless" })
    expect(passwordlessSwitch.getAttribute("aria-checked")).toBe("true")

    fireEvent.click(passwordlessSwitch)

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Could not toggle Passwordless")
    expect(alert.textContent).toContain("could not reach the auth service")

    // The switch is bound to the query's value, not to local state, so a
    // command that never invalidates leaves it exactly where it was.
    expect(
      screen.getByRole("switch", { name: "Passwordless" }).getAttribute("aria-checked"),
    ).toBe("true")
  })
})

describe("AuthPluginsPage", () => {
  it("carries a visible, readable note explaining why only the sign-in features are listed", async () => {
    const { client } = stubClient(toggles)
    renderPage(AuthPluginsPage, client)

    const note = await screen.findByRole("status")
    expect(note.textContent).toContain("not the full list of installed plugins")
    expect(note.textContent).toContain(
      "The contract has no intent that enumerates installed plugins",
    )
  })

  it("still lists the nine feature rows read-only", async () => {
    const { client } = stubClient(toggles)
    renderPage(AuthPluginsPage, client)
    await waitFor(() => expect(screen.getByText("Passwordless")).toBeTruthy())
    expect(screen.getByText("MFA")).toBeTruthy()
    expect(screen.queryByRole("switch")).toBeNull()
  })
})
