import { describe, expect, it } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { RotationPage } from "../src/pages/rotation"
import { rotationPath } from "../src/keys"
import {
  failingClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

function policy(over: Record<string, unknown> = {}) {
  return {
    id: "pol_01",
    secretKey: "db/primary.password",
    intervalSeconds: 86400,
    enabled: true,
    rotatable: true,
    lastRotatedAt: "2026-09-22T04:00:00Z",
    nextRotationAt: "2026-09-29T04:00:00Z",
    createdAt: "2026-09-20T10:00:00Z",
    updatedAt: "2026-09-22T04:00:00Z",
    ...over,
  }
}

const POLICIES = {
  policies: [
    policy(),
    policy({
      id: "pol_02",
      secretKey: "api-token",
      intervalSeconds: 21600,
      rotatable: false,
      lastRotatedAt: undefined,
    }),
  ],
  total: 2,
}

function rowFor(text: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("RotationPage", () => {
  it("asks rotation.policies for the first page with an exact limit and offset", async () => {
    const { client, sent } = recordingQueryClient({ "rotation.policies": POLICIES })
    renderPage(RotationPage, client)
    await screen.findByText("api-token")
    const list = sent.filter((i) => i.intent === "rotation.policies")
    expect(list.length).toBeGreaterThan(0)
    expect(list[0]?.params).toEqual({ limit: 25, offset: 0 })
  })

  it("pages to offset 25 on page two", async () => {
    const { client, sent } = recordingQueryClient({
      "rotation.policies": { policies: POLICIES.policies, total: 31 },
    })
    renderPage(RotationPage, client)
    await screen.findByText("api-token")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await screen.findByText(/Page 2 of 2/)
    const params = sent
      .filter((i) => i.intent === "rotation.policies")
      .map((i) => i.params)
    expect(params).toContainEqual({ limit: 25, offset: 25 })
  })

  it("shows the server total in the caption, not the page length", async () => {
    renderPage(
      RotationPage,
      stubClient({ "rotation.policies": { policies: POLICIES.policies, total: 31 } })
    )
    await screen.findByText("api-token")
    expect(screen.getByText("31 policies")).toBeTruthy()
  })

  it("uses the singular for a total of one", async () => {
    renderPage(
      RotationPage,
      stubClient({ "rotation.policies": { policies: [policy()], total: 1 } })
    )
    await screen.findByText("db/primary.password")
    expect(screen.getByText("1 policy")).toBeTruthy()
  })

  it("states the header description exactly", async () => {
    renderPage(RotationPage, stubClient({ "rotation.policies": POLICIES }))
    expect(
      await screen.findByText(
        "Due policies are checked once a minute in each vault process. A policy only rotates a secret whose application registered a rotator."
      )
    ).toBeTruthy()
  })

  it("says so and still counts when there are no policies", async () => {
    renderPage(
      RotationPage,
      stubClient({ "rotation.policies": { policies: [], total: 0 } })
    )
    expect(
      await screen.findByText("No rotation policies. Set one up from a secret's page.")
    ).toBeTruthy()
    expect(screen.getByText("0 policies")).toBeTruthy()
  })

  it("links each secret through rotationPath, in mono", async () => {
    renderPage(RotationPage, stubClient({ "rotation.policies": POLICIES }))
    const link = await screen.findByRole("link", { name: "db/primary.password" })
    expect(link.getAttribute("href")).toBe(rotationPath("db/primary.password"))
    expect(link.getAttribute("href")).toBe("/rotation/db%2Fprimary.password")
    expect(link.closest("td")?.className).toMatch(/font-mono/)
  })

  it("reads the interval in whole days, hours or minutes, and falls back to seconds", async () => {
    const policies = [
      policy({ id: "a", secretKey: "one-day", intervalSeconds: 86400 }),
      policy({ id: "b", secretKey: "six-hours", intervalSeconds: 21600 }),
      policy({ id: "c", secretKey: "one-hour", intervalSeconds: 3600 }),
      policy({ id: "d", secretKey: "odd", intervalSeconds: 5400 }),
      policy({ id: "e", secretKey: "ninety", intervalSeconds: 90 }),
    ]
    renderPage(
      RotationPage,
      stubClient({ "rotation.policies": { policies, total: policies.length } })
    )
    await screen.findByText("one-day")
    expect(within(rowFor("one-day")).getByText("every 1 day")).toBeTruthy()
    expect(within(rowFor("six-hours")).getByText("every 6 hours")).toBeTruthy()
    expect(within(rowFor("one-hour")).getByText("every 1 hour")).toBeTruthy()
    expect(within(rowFor("odd")).getByText("every 90 minutes")).toBeTruthy()
    expect(within(rowFor("ninety")).getByText("every 90 seconds")).toBeTruthy()
  })

  it("shows status and rotator badges", async () => {
    renderPage(
      RotationPage,
      stubClient({
        "rotation.policies": {
          policies: [
            policy(),
            policy({
              id: "pol_02",
              secretKey: "api-token",
              enabled: false,
              rotatable: false,
            }),
          ],
          total: 2,
        },
      })
    )
    await screen.findByText("api-token")
    const on = rowFor("db/primary.password")
    expect(within(on).getByText("Enabled")).toBeTruthy()
    expect(within(on).getByText("Rotator registered")).toBeTruthy()
    const off = rowFor("api-token")
    expect(within(off).getByText("Disabled")).toBeTruthy()
    expect(within(off).getByText("No rotator")).toBeTruthy()
  })

  it("shows next rotation only for an enabled policy, even when the payload carries one", async () => {
    renderPage(
      RotationPage,
      stubClient({
        "rotation.policies": {
          policies: [
            policy(),
            // A misbehaving server: disabled, yet it sent a next time.
            policy({
              id: "pol_02",
              secretKey: "api-token",
              enabled: false,
              nextRotationAt: "2026-10-05T04:00:00Z",
            }),
          ],
          total: 2,
        },
      })
    )
    await screen.findByText("api-token")
    expect(within(rowFor("db/primary.password")).queryByLabelText(/no next rotation/i)).toBeNull()
    expect(within(rowFor("api-token")).getByLabelText(/no next rotation/i)).toBeTruthy()
    const shown = new Date("2026-10-05T04:00:00Z").toLocaleString()
    expect(within(rowFor("api-token")).queryByText(shown)).toBeNull()
  })

  it("reads a policy that never rotated as no last rotation", async () => {
    renderPage(RotationPage, stubClient({ "rotation.policies": POLICIES }))
    await screen.findByText("api-token")
    expect(within(rowFor("api-token")).getByLabelText(/no last rotation/i)).toBeTruthy()
    expect(within(rowFor("db/primary.password")).queryByLabelText(/no last rotation/i)).toBeNull()
  })

  it("renders the error card, not an empty table, when the list fails", async () => {
    renderPage(
      RotationPage,
      failingClient(new ContractError("INTERNAL", "vault store is down"))
    )
    expect(await screen.findByText(/Rotation policies unavailable/i)).toBeTruthy()
    expect(screen.getByText(/vault store is down/)).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.queryByText(/No rotation policies/)).toBeNull()
  })
})
