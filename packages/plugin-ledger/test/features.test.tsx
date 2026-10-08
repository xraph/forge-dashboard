import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { LedgerFeaturesPage } from "../src/pages/features"
import { recordingQueryClient, renderPage, stubClient } from "./harness"
import { aCatalogFeature, aPage } from "./fixtures"

const LIST = aPage([
  aCatalogFeature(),
  aCatalogFeature({
    id: "feat_sso",
    key: "sso",
    name: "Single sign-on",
    type: "boolean",
    default_limit: 1,
    period: "none",
  }),
  aCatalogFeature({
    id: "feat_seats",
    key: "seats",
    name: "Seats",
    type: "seat",
    default_limit: -1,
    period: "none",
    status: "draft",
  }),
])

describe("LedgerFeaturesPage", () => {
  it("reads this app's catalog first, then the shared one when asked", async () => {
    const { client, sent } = recordingQueryClient({ "features.list": LIST })
    renderPage(LedgerFeaturesPage, client)
    await screen.findByRole("link", { name: "Seats" })
    expect(sent[0].params).toEqual({ limit: 50, offset: 0 })
    fireEvent.change(screen.getByLabelText("Catalog"), {
      target: { value: "shared" },
    })
    await screen.findByRole("link", { name: "Seats" })
    await waitFor(() =>
      expect(sent.at(-1)?.params).toEqual({
        limit: 50,
        offset: 0,
        global: true,
      })
    )
  })

  it("sends the status filter, and goes back to the first page when it changes", async () => {
    const { client, sent } = recordingQueryClient({ "features.list": LIST })
    renderPage(LedgerFeaturesPage, client)
    await screen.findByRole("link", { name: "Seats" })
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "draft" },
    })
    await waitFor(() =>
      expect(sent.at(-1)?.params).toEqual({
        limit: 50,
        offset: 0,
        status: "draft",
      })
    )
  })

  it("asks for the next offset when there is more", async () => {
    const { client, sent } = recordingQueryClient({
      "features.list": aPage([aCatalogFeature()], { has_more: true }),
    })
    renderPage(LedgerFeaturesPage, client)
    await screen.findByRole("link", { name: "API calls" })
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() =>
      expect(sent.at(-1)?.params).toEqual({ limit: 50, offset: 50 })
    )
  })

  it("reads limits as a person would and counts the rows", async () => {
    renderPage(LedgerFeaturesPage, stubClient({ "features.list": LIST }))
    await screen.findByRole("link", { name: "Seats" })
    expect(screen.getByText("3 features")).toBeTruthy()
    const row = (name: string) =>
      screen
        .getAllByRole("row")
        .find((r) => within(r).queryByRole("link", { name }))!
    expect(within(row("API calls")).getByText("10,000")).toBeTruthy()
    expect(within(row("Single sign-on")).getByText("Included")).toBeTruthy()
    expect(within(row("Seats")).getByText("Unlimited")).toBeTruthy()
    expect(
      within(row("Seats")).getByText("Draft", {
        selector: '[data-slot="badge"]',
      })
    ).toBeTruthy()
    expect(within(row("API calls")).getByText("api_calls").className).toMatch(
      /font-mono/
    )
  })

  it("marks a shared feature", async () => {
    renderPage(
      LedgerFeaturesPage,
      stubClient({ "features.list": aPage([aCatalogFeature({ app_id: "" })]) })
    )
    await screen.findByText("API calls")
    expect(
      screen.getByText("Shared", { selector: '[data-slot="badge"]' })
    ).toBeTruthy()
  })

  it("says which kind of empty it is", async () => {
    renderPage(LedgerFeaturesPage, stubClient({ "features.list": aPage([]) }))
    expect(await screen.findByText("No features yet.")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Catalog"), {
      target: { value: "shared" },
    })
    expect(await screen.findByText("No shared features.")).toBeTruthy()
  })
})
