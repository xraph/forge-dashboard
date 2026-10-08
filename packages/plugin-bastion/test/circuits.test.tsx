import { describe, expect, it } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { BastionCircuitsPage } from "../src/pages/circuits"
import type { CircuitsList, CircuitView } from "../src/types"
import { recordingCommandClient, renderPage, stubClient } from "./harness"

// Base UI dialogs read PointerEvent, which jsdom lacks.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim })
}

function circuit(over: Partial<CircuitView> = {}): CircuitView {
  return {
    targetId: "9b2f/1",
    url: "http://orders-b:8080",
    routes: [
      { routeId: "manual-/users", path: "/gw/users", targetId: "9b2f/1" },
    ],
    tracked: true,
    state: "open",
    failureCount: 5,
    lastFailure: "2026-09-30T09:41:00Z",
    lastStateChange: "2026-09-30T09:41:00Z",
    ...over,
  }
}

function list(over: Partial<CircuitsList> = {}): CircuitsList {
  const circuits = over.circuits ?? [
    circuit(),
    circuit({
      targetId: "t2",
      url: "http://users:8080",
      state: "closed",
      failureCount: 0,
    }),
    circuit({
      targetId: "t3",
      url: "http://search:50051",
      tracked: false,
      state: "closed",
      failureCount: 0,
      lastFailure: null,
      lastStateChange: null,
    }),
  ]
  return {
    enabled: true,
    failureThreshold: 5,
    resetTimeoutSeconds: 30,
    halfOpenMax: 3,
    circuits,
    total: circuits.length,
    ...over,
  }
}

function row(text: string) {
  return screen.getByText(text).closest("tr") as HTMLElement
}

describe("BastionCircuitsPage", () => {
  it("states the breaker settings and badges each target", async () => {
    renderPage(BastionCircuitsPage, stubClient({ "circuits.list": list() }))
    await screen.findByText(/after 5 consecutive transport failures/)
    expect(within(row("http://orders-b:8080")).getByText("Open")).toBeTruthy()
    expect(
      within(row("http://search:50051")).getByText("Not tracked")
    ).toBeTruthy()
    expect(
      within(row("http://search:50051")).getByLabelText("no failure")
    ).toBeTruthy()
    expect(screen.getByText("3 targets")).toBeTruthy()
  })

  it("offers Reset only on a tracked breaker that is not closed", async () => {
    renderPage(BastionCircuitsPage, stubClient({ "circuits.list": list() }))
    await screen.findByText("http://orders-b:8080")
    expect(
      within(row("http://orders-b:8080")).getByRole("button", { name: "Reset" })
    ).toBeTruthy()
    expect(
      within(row("http://users:8080")).queryByRole("button", { name: "Reset" })
    ).toBeNull()
    expect(
      within(row("http://search:50051")).queryByRole("button", {
        name: "Reset",
      })
    ).toBeNull()
  })

  it("does not read switched-off breakers as good news", async () => {
    renderPage(
      BastionCircuitsPage,
      stubClient({ "circuits.list": list({ enabled: false }) })
    )
    expect(
      await screen.findByText(
        "Circuit breaking is switched off in the gateway config, so every target is ungated."
      )
    ).toBeTruthy()
  })

  it("resets after a confirm and says so", async () => {
    const { client, sent } = recordingCommandClient(
      { "circuits.list": list() },
      { "circuits.reset": { targetId: "9b2f/1", state: "closed" } }
    )
    renderPage(BastionCircuitsPage, client)
    fireEvent.click(
      within(
        await screen
          .findByText("http://orders-b:8080")
          .then((el) => el.closest("tr") as HTMLElement)
      ).getByRole("button", { name: "Reset" })
    )
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }))
    expect(
      await screen.findByText("Breaker reset for http://orders-b:8080.")
    ).toBeTruthy()
    expect(sent).toEqual([
      { intent: "circuits.reset", payload: { targetId: "9b2f/1" } },
    ])
  })

  it("shows a reset failure inside the dialog", async () => {
    const client = {
      extension: "bastion",
      query: async () => list(),
      command: async () => {
        throw new ContractError(
          "NOT_FOUND",
          "this target has no circuit breaker yet; it gets one on its first proxied request"
        )
      },
    } as unknown as ScopedClient
    renderPage(BastionCircuitsPage, client)
    fireEvent.click(
      within(
        await screen
          .findByText("http://orders-b:8080")
          .then((el) => el.closest("tr") as HTMLElement)
      ).getByRole("button", { name: "Reset" })
    )
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }))
    expect(
      await within(dialog).findByText(/no circuit breaker yet/)
    ).toBeTruthy()
  })
})
