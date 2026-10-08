import { screen } from "@testing-library/react"
import { expect, it } from "vitest"
import { RecordsPage } from "../src/pages/records"
import type { UsageRecords } from "../src/types"
import { answer, fixtureClient } from "./fixtures"
import { renderWithClient } from "./harness"

it("shows each recorded request ID so an operator can correlate gateway logs", async () => {
  const page = answer<UsageRecords>("usage.records")
  const requestId = page.items.find((row) => row.requestId)?.requestId
  expect(requestId).toBeTruthy()
  renderWithClient(<RecordsPage />, fixtureClient().client)
  expect(await screen.findByText(requestId!)).toBeTruthy()
})
