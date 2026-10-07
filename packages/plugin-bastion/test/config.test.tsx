import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { BastionConfigPage } from "../src/pages/config"
import type { ConfigDetail } from "../src/types"
import { renderPage, stubClient } from "./harness"

const CONFIG: ConfigDetail = {
  sections: [
    { id: "retry", title: "Retry", enabled: true, note: "Nothing in the proxy calls the retry policy, so no request is retried whatever this says.", settings: [{ key: "Max attempts", value: "3" }] },
    { id: "tls", title: "Upstream TLS", enabled: false, settings: [{ key: "Client key", value: "set" }] },
    { id: "timeouts", title: "Timeouts", enabled: null, settings: [{ key: "Connect", value: "5s" }] },
    { id: "empty", title: "Empty", enabled: null, settings: [] },
  ],
}

function section(title: string) {
  return screen.getByRole("heading", { name: new RegExp(`^${title}`) }).closest("section") as HTMLElement
}

describe("BastionConfigPage", () => {
  it("shows each section with its switch, note and settings", async () => {
    renderPage(BastionConfigPage, stubClient({ "config.detail": CONFIG }))
    await screen.findByRole("heading", { name: /^Retry/ })
    expect(within(section("Retry")).getByText("Enabled")).toBeTruthy()
    expect(within(section("Retry")).getByRole("note").textContent).toMatch(/no request is retried/)
    expect(within(section("Upstream TLS")).getByText("Disabled")).toBeTruthy()
    expect(within(section("Upstream TLS")).getByText("set")).toBeTruthy()
  })

  it("shows no switch for a section without one, and none for a section without settings", async () => {
    renderPage(BastionConfigPage, stubClient({ "config.detail": CONFIG }))
    await screen.findByRole("heading", { name: /^Timeouts/ })
    expect(within(section("Timeouts")).queryByText(/Enabled|Disabled/)).toBeNull()
    expect(within(section("Empty")).getByLabelText("no settings")).toBeTruthy()
  })
})
