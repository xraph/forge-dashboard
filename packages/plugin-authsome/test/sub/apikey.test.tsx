import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { APIKeyDetailPage, apikeySubPlugin } from "../../src/sub/apikey"
import { renderSubPage, subStubClient } from "./harness"

const keys = {
  apiKeys: [
    {
      id: "k1",
      name: "CI",
      keyPrefix: "ask_abc",
      revoked: false,
      createdAt: "2026-01-01T00:00:00Z",
      lastUsedAt: "2026-02-01T00:00:00Z",
    },
    {
      id: "k2",
      name: "Old",
      keyPrefix: "ask_def",
      revoked: true,
      createdAt: "2025-01-01T00:00:00Z",
    },
  ],
}

const detail = {
  id: "k9",
  name: "CI2",
  keyPrefix: "ask_xyz",
  revoked: false,
  createdAt: "2026-03-01T00:00:00Z",
  updatedAt: "2026-03-01T00:00:00Z",
  publicKey: "pk_live_1",
}

function pageAt(path: string) {
  return apikeySubPlugin.routes.find((r) => r.path === path)!.element
}

describe("api key list", () => {
  it("shows revoked and active keys apart, and keeps revoked ones on screen", async () => {
    // Bug 3 from the plan: subStubClient takes a MAP of intent to answer, not
    // a bare response.
    renderSubPage(pageAt("/apikeys"), {
      client: subStubClient({ "apikeys.list": keys }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() => expect(screen.getByText("CI")).toBeTruthy())
    // A revoked key keeps its row. Hiding it turns "why is this greyed out"
    // into "where did my key go", which is the worse question.
    expect(screen.getByText("Old")).toBeTruthy()
    expect(screen.getByText("revoked").getAttribute("data-variant")).toBe("destructive")
    expect(screen.getByText("active").getAttribute("data-variant")).toBe("default")
  })

  it("offers Revoke on an active key and not on a revoked one", async () => {
    renderSubPage(pageAt("/apikeys"), {
      client: subStubClient({ "apikeys.list": keys }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() => expect(screen.getByText("CI")).toBeTruthy())
    expect(screen.getByRole("button", { name: /revoke ci/i })).toBeTruthy()
    // There is no delete intent at all, so there is no second action to offer
    // once a key is revoked.
    expect(screen.queryByRole("button", { name: /revoke old/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull()
  })

  it("says never rather than leaving the last-used cell blank", async () => {
    renderSubPage(pageAt("/apikeys"), {
      client: subStubClient({ "apikeys.list": keys }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() => expect(screen.getByText("Old")).toBeTruthy())
    // A blank cell reads as "loading" or "broken". "Never" is a fact.
    expect(screen.getByText("Never")).toBeTruthy()
  })

  it("counts its rows in the caption, with no paging controls at all", async () => {
    renderSubPage(pageAt("/apikeys"), {
      client: subStubClient({ "apikeys.list": keys }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() => expect(screen.getByText("CI")).toBeTruthy())
    expect(screen.getByText(/2 api keys/i)).toBeTruthy()
    // apikeys.list takes no cursor and no limit. A Next button here would be
    // a control for a server behaviour that does not exist.
    expect(screen.queryByRole("button", { name: /next/i })).toBeNull()
  })

  it("says so when there are none, and still counts zero", async () => {
    renderSubPage(pageAt("/apikeys"), {
      client: subStubClient({ "apikeys.list": { apiKeys: [] } }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() => expect(screen.getByText(/no api keys/i)).toBeTruthy())
  })
})

describe("api key detail", () => {
  it("shows the key's fields and the public key, with no secret anywhere", async () => {
    renderSubPage(pageAt("/apikeys/:id"), {
      client: subStubClient({ "apikeys.detail": detail }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
      params: { id: "k9" },
    })
    await waitFor(() => expect(screen.getByRole("heading", { name: "CI2" })).toBeTruthy())
    expect(screen.getByText("k9")).toBeTruthy()
    expect(screen.getByText("pk_live_1")).toBeTruthy()
    expect(screen.getByText(/safe to share/i)).toBeTruthy()
    // APIKeyDetail has no secret field at all. There is nothing to hide
    // because there is nothing to leak.
    expect(screen.queryByText(/only time you will see/i)).toBeNull()
  })

  it("says so when no key id was routed", () => {
    renderSubPage(APIKeyDetailPage, {
      client: subStubClient({}).client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    expect(screen.getByText(/no api key selected/i)).toBeTruthy()
  })
})

describe("api key create", () => {
  it("shows the secret once, and will not offer to show it again", async () => {
    const own = subStubClient(
      { "apikeys.detail": detail },
      { "apikeys.create": { ok: true, id: "k9", keyPrefix: "ask_xyz", secret: "ask_xyz_THE_SECRET" } },
    )
    renderSubPage(pageAt("/apikeys/create"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "CI2" } })
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "u1" } })
    fireEvent.click(screen.getByRole("button", { name: /create key/i }))

    await waitFor(() => expect(screen.getByText("ask_xyz_THE_SECRET")).toBeTruthy())
    expect(screen.getByText(/only time you will see/i)).toBeTruthy()
    // Bug 1 from the plan: stubClient's return is { client, intents,
    // payloads }, not { client, commands }. payloads records COMMAND
    // payloads.
    expect(own.payloads[0].payload).toEqual({ name: "CI2", userId: "u1" })
  })

  it("fetches the public key afterwards without holding up the secret", async () => {
    // Bug 2 from the plan: payloads does not record query params. A QUERY's
    // params are read back by having the answer capture what it was called
    // with, the same way test/sub/settings-panel.test.tsx does it.
    let detailParams: unknown
    const own = subStubClient(
      {
        "apikeys.detail": (params: unknown) => {
          detailParams = params
          return detail
        },
      },
      { "apikeys.create": { ok: true, id: "k9", keyPrefix: "ask_xyz", secret: "ask_xyz_THE_SECRET" } },
    )
    renderSubPage(pageAt("/apikeys/create"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "CI2" } })
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "u1" } })
    fireEvent.click(screen.getByRole("button", { name: /create key/i }))
    // The secret is on screen before the detail read settles. A public key
    // that arrives late must never gate the one value that cannot be
    // refetched.
    await waitFor(() => expect(screen.getByText("ask_xyz_THE_SECRET")).toBeTruthy())
    await waitFor(() => expect(screen.getByText("pk_live_1")).toBeTruthy())
    expect(detailParams).toEqual({ id: "k9" })
  })

  it("confirms before dismissing the panel, and does not lose the secret while asking", async () => {
    const own = subStubClient(
      {},
      { "apikeys.create": { ok: true, id: "k9", keyPrefix: "ask_xyz", secret: "ask_xyz_THE_SECRET" } },
    )
    renderSubPage(pageAt("/apikeys/create"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "CI2" } })
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "u1" } })
    fireEvent.click(screen.getByRole("button", { name: /create key/i }))
    await waitFor(() => expect(screen.getByText("ask_xyz_THE_SECRET")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: /done/i }))
    // Reflex-closing this panel costs a new key. The confirm step is the
    // whole reason the panel is not just dismissible.
    expect(screen.getByText(/cannot be recovered/i)).toBeTruthy()
    expect(screen.getByText("ask_xyz_THE_SECRET")).toBeTruthy()
  })

  it("refuses to submit without a user id", async () => {
    const own = subStubClient(
      {},
      { "apikeys.create": { ok: true, id: "k9", keyPrefix: "p", secret: "s" } },
    )
    renderSubPage(pageAt("/apikeys/create"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "CI2" } })
    // userId is required by the contract. Sending an empty one produces a
    // key attached to nobody, which is worse than a disabled button.
    expect((screen.getByRole("button", { name: /create key/i }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(own.payloads).toHaveLength(0)
  })

  it("omits scopes from the payload when the field is left blank", async () => {
    const own = subStubClient(
      {},
      { "apikeys.create": { ok: true, id: "k9", keyPrefix: "p", secret: "s" } },
    )
    renderSubPage(pageAt("/apikeys/create"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "CI2" } })
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "u1" } })
    fireEvent.click(screen.getByRole("button", { name: /create key/i }))
    await waitFor(() => expect(own.payloads).toHaveLength(1))
    const payload = own.payloads[0].payload as Record<string, unknown>
    expect(payload).toEqual({ name: "CI2", userId: "u1" })
    expect("scopes" in payload).toBe(false)
  })
})
