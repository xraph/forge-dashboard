import { useState } from "react"
import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { TenantFilter } from "../src/components/tenant-filter"
import { withTenant } from "../src/tenant"

function Probe() {
  const [tenant, setTenant] = useState<string | null>(null)
  return (
    <div>
      <TenantFilter value={tenant} onChange={setTenant} />
      <output aria-label="sent">{JSON.stringify(withTenant({ limit: 25 }, tenant))}</output>
    </div>
  )
}

describe("withTenant", () => {
  it("All leaves the field out, No tenant sends an empty string", () => {
    expect(withTenant({ limit: 25 }, null)).toEqual({ limit: 25 })
    expect("tenant" in withTenant({}, null)).toBe(false)
    expect(withTenant({}, "")).toEqual({ tenant: "" })
    expect(withTenant({}, "acme")).toEqual({ tenant: "acme" })
  })
})

describe("TenantFilter", () => {
  it("starts on every tenant", () => {
    render(<Probe />)
    expect(screen.getByLabelText("sent").textContent).toBe('{"limit":25}')
  })

  it("narrows to untenanted rows", () => {
    render(<Probe />)
    fireEvent.change(screen.getByLabelText("Tenant"), { target: { value: "none" } })
    expect(screen.getByLabelText("sent").textContent).toBe('{"limit":25,"tenant":""}')
  })

  it("narrows to a named tenant, trimmed, and treats a blank name as no filter yet", () => {
    render(<Probe />)
    fireEvent.change(screen.getByLabelText("Tenant"), { target: { value: "named" } })
    expect(screen.getByLabelText("sent").textContent).toBe('{"limit":25}')
    fireEvent.change(screen.getByLabelText("Tenant ID"), { target: { value: "  acme " } })
    expect(screen.getByLabelText("sent").textContent).toBe('{"limit":25,"tenant":"acme"}')
    fireEvent.change(screen.getByLabelText("Tenant"), { target: { value: "all" } })
    expect(screen.getByLabelText("sent").textContent).toBe('{"limit":25}')
    expect(screen.queryByLabelText("Tenant ID")).toBeNull()
  })
})
