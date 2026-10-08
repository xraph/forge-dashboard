import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { useCollectionOptions } from "../src/collection-options"
import { pendingClient, scriptedClient } from "./harness"

const COL = "col_01k70000000000000000000001"
const GONE = "col_01k70000000000000000000777"

const LISTED = {
  items: [{ id: COL, name: "support-articles", tenant_id: "", metadata: {} }],
  total: 1,
  limit: 100,
  offset: 0,
}

function hook(client: ScopedClient, selected: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PluginProvider client={client}>{children}</PluginProvider>
  )
  return renderHook(() => useCollectionOptions(selected, "All collections"), {
    wrapper,
  })
}

describe("useCollectionOptions", () => {
  it("lists the empty choice first, then each collection by name", async () => {
    const { client, queried } = scriptedClient({ "collections.list": LISTED })
    const { result } = hook(client, "")
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.options).toEqual([
      { label: "All collections", value: "" },
      { label: "support-articles", value: COL },
    ])
    expect(result.current.note).toBeNull()
    expect(result.current.error).toBe(false)
    expect(queried[0]).toEqual({
      intent: "collections.list",
      params: { limit: 100 },
    })
  })

  it("labels a selected ID as loading until the list answers", () => {
    const { result } = hook(pendingClient(), GONE)
    expect(result.current.loading).toBe(true)
    expect(result.current.options.at(-1)).toEqual({
      label: "Loading collections…",
      value: GONE,
    })
  })

  it("marks a selected ID the list does not hold as not found", async () => {
    const { client } = scriptedClient({ "collections.list": LISTED })
    const { result } = hook(client, GONE)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.options.at(-1)).toEqual({
      label: `${GONE} (not found)`,
      value: GONE,
    })
  })

  it("does not add a second option for a selected collection that is listed", async () => {
    const { client } = scriptedClient({ "collections.list": LISTED })
    const { result } = hook(client, COL)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.options).toHaveLength(2)
  })

  it("notes a failed read and keeps the raw ID selectable", async () => {
    const { client } = scriptedClient({
      "collections.list": new ContractError("INTERNAL", "store is down"),
    })
    const { result } = hook(client, GONE)
    await waitFor(() =>
      expect(result.current.note).toBe(
        "Couldn't load the collection list: store is down"
      )
    )
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe(true)
    expect(result.current.options.at(-1)).toEqual({ label: GONE, value: GONE })
  })

  it("says when the picker holds only the first page of collections", async () => {
    const { client } = scriptedClient({
      "collections.list": { ...LISTED, total: 140 },
    })
    const { result } = hook(client, "")
    await waitFor(() =>
      expect(result.current.note).toBe(
        "The picker lists the first 1 of 140 collections."
      )
    )
    expect(result.current.error).toBe(false)
  })
})
