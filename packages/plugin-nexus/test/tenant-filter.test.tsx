import { useState } from "react"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TenantFilter, tenantParams } from "../src/components/tenant-filter"
import { clientFor, renderWithClient } from "./harness"

function Filter() {
  const [value, setValue] = useState<string>()
  return (
    <>
      <TenantFilter value={value} onChange={setValue} />
      <output>{JSON.stringify(tenantParams(value))}</output>
    </>
  )
}

describe("tenant filter", () => {
  it("searches and reaches later pages, then clears scope by omission", async () => {
    const { client, sent } = clientFor({
      "tenants.get": { id: "tenant-2", name: "Second tenant" },
      "tenants.list": (p: Record<string, unknown>) =>
        p.search
          ? {
              items: [{ id: "search-result", name: "Found tenant" }],
              nextCursor: "",
            }
          : p.cursor
            ? {
                items: [{ id: "tenant-2", name: "Second tenant" }],
                nextCursor: "",
              }
            : {
                items: [{ id: "tenant-1", name: "First tenant" }],
                nextCursor: "next",
              },
    })
    renderWithClient(<Filter />, client)
    fireEvent.click(screen.getByRole("button", { name: "Tenant: All tenants" }))
    fireEvent.click(
      await screen.findByRole("button", { name: "Load more tenants" })
    )
    fireEvent.click(
      await screen.findByRole("button", { name: "Second tenant" })
    )
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        '{"tenantId":"tenant-2"}'
      )
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Tenant: Second tenant" })
    )
    fireEvent.change(screen.getByRole("textbox", { name: "Search tenants" }), {
      target: { value: "Found" },
    })
    expect(
      await screen.findByRole("button", { name: "Found tenant" })
    ).toBeTruthy()
    expect(sent.some((x) => x.params?.cursor === "next")).toBe(true)
    expect(
      sent.some((x) => x.params?.search === "Found" && !x.params.cursor)
    ).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "All tenants" }))
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("{}")
    )
    expect(tenantParams(undefined)).toEqual({})
  })
})
