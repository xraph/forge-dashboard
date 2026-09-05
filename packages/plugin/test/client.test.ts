import { beforeEach, describe, expect, it, vi } from "vitest"
import { ContractError, createScopedClient } from "../src/client"

const BASE = "/dashboard/api/dashboard/v1"

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

describe("createScopedClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("sends the contributor it was scoped to, not one the caller supplies", async () => {
    const fetchMock = mockFetch({ ok: true, envelope: "v1", kind: "query", data: { n: 1 } })
    const client = createScopedClient(BASE, "billing", fetchMock)

    await client.query("invoices.list", { page: 1 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(BASE)
    const sent = JSON.parse(init.body)
    expect(sent.contributor).toBe("billing")
    expect(sent.kind).toBe("query")
    expect(sent.intent).toBe("invoices.list")
    expect(sent.params).toEqual({ page: 1 })
    expect(sent.envelope).toBe("v1")
  })

  it("returns the envelope's data, not the envelope", async () => {
    const fetchMock = mockFetch({ ok: true, envelope: "v1", kind: "query", data: { n: 7 } })
    const client = createScopedClient(BASE, "billing", fetchMock)

    await expect(client.query("x.y")).resolves.toEqual({ n: 7 })
  })

  it("throws a ContractError carrying the server's code", async () => {
    const fetchMock = mockFetch({
      ok: false,
      envelope: "v1",
      error: { code: "NOT_FOUND", message: "NOT_FOUND: nope" },
    })
    const client = createScopedClient(BASE, "billing", fetchMock)

    await expect(client.query("x.y")).rejects.toThrow(ContractError)
    await expect(client.query("x.y")).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  // A transport failure and a contract-level error are different things and the
  // caller has to be able to tell them apart.
  it("throws with a TRANSPORT code when the response is not ok", async () => {
    const fetchMock = mockFetch({}, 500)
    const client = createScopedClient(BASE, "billing", fetchMock)

    await expect(client.query("x.y")).rejects.toMatchObject({ code: "TRANSPORT" })
  })

  it("sends kind command for commands", async () => {
    const fetchMock = mockFetch({ ok: true, envelope: "v1", kind: "command", data: null })
    const client = createScopedClient(BASE, "billing", fetchMock)

    await client.command("invoice.void", { id: "1" })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).kind).toBe("command")
  })
})
