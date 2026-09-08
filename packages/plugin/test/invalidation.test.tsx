import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { createScopedClient } from "../src/client"
import { PluginProvider } from "../src/context"
import { useCommand, useQuery } from "../src/hooks"
import { queryStore } from "../src/store"

/**
 * Builds a client wired to the store exactly as the host does, so this test
 * exercises the real join rather than a stand-in for it.
 */
function wiredClient(extension: string, fetchImpl: typeof fetch) {
  return createScopedClient("/contract", extension, fetchImpl, (info) => {
    if (info.kind === "command" && info.meta.invalidates?.length) {
      queryStore.invalidate(info.extension, info.meta.invalidates)
    }
  })
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response
}

function Page() {
  const list = useQuery<{ total: number }>("users.list")
  const ban = useCommand("users.ban")
  return (
    <>
      <p>total {list.data?.total ?? "?"}</p>
      <button onClick={() => void ban.execute({ id: "u1" })}>ban</button>
    </>
  )
}

describe("command invalidation", () => {
  it("refreshes a mounted read named in meta.invalidates, with no refetch in page code", async () => {
    queryStore.clear()
    let total = 2
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { intent?: string }
      if (body.intent === "users.list") {
        return ok({ ok: true, data: { total }, meta: { cacheControl: { staleTime: "60s" } } })
      }
      if (body.intent === "users.ban") {
        total = 1
        return ok({ ok: true, data: { ok: true }, meta: { invalidates: ["users.list"] } })
      }
      return ok({ token: "t" })
    }) as unknown as typeof fetch

    render(
      <PluginProvider client={wiredClient("auth", fetchImpl)}>
        <Page />
      </PluginProvider>,
    )

    await waitFor(() => expect(screen.getByText("total 2")).toBeTruthy())
    screen.getByRole("button", { name: "ban" }).click()
    await waitFor(() => expect(screen.getByText("total 1")).toBeTruthy())
  })

  it("leaves another extension's cache alone even when the command names its intent", async () => {
    queryStore.clear()
    const authKey = queryStore.keyOf("auth", "users.list")
    queryStore.read(authKey, () => Promise.resolve({ total: 2 }), 60_000)
    await waitFor(() => expect(queryStore.snapshot(authKey).data).toBeTruthy())

    const fetchImpl = vi.fn(async () =>
      ok({ ok: true, data: { ok: true }, meta: { invalidates: ["users.list"] } }),
    ) as unknown as typeof fetch

    await wiredClient("organization", fetchImpl).command("orgs.removeMember", { id: "m1" })

    expect(queryStore.snapshot(authKey).data).toEqual({ total: 2 })
  })
})
