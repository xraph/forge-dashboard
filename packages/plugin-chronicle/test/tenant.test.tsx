import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TenantValue } from "../src/components/tenant"

describe("TenantValue", () => {
  it("shows a tenant id in mono", () => {
    render(<TenantValue tenantId="globex" />)
    expect(screen.getByText("globex").className).toContain("font-mono")
  })

  it("says app level for an empty tenant, in the caller's words", () => {
    const { unmount } = render(<TenantValue tenantId="" />)
    expect(screen.getByText("App level")).toBeTruthy()
    unmount()
    render(<TenantValue tenantId="" appLevel="App level, every tenant" />)
    expect(screen.getByText("App level, every tenant")).toBeTruthy()
  })

  it("never calls a tenant the server did not send app level", () => {
    render(<TenantValue tenantId={undefined} />)
    expect(screen.queryByText(/App level/)).toBeNull()
    expect(screen.getByText("Not reported by this server").className).toContain("text-muted-foreground")
  })
})
