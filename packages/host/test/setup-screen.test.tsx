import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AuthIntents, SetupStatus } from "@forge-go/dashboard-plugin"

const mocks = vi.hoisted(() => ({
  status: {
    data: {
      pending: true,
      platform: {
        name: "TwinOS Office",
        slug: "twinos-office",
        logo: "https://example.com/logo.svg",
      },
      environment: {
        name: "Development",
        slug: "development",
        type: "development",
        isDefault: true,
        color: "#2563eb",
        description: "Local development",
      },
    } as SetupStatus | undefined,
    loading: false,
    error: undefined as { code: string; message: string } | undefined,
    refetch: vi.fn(),
  },
  config: {
    data: { brand: "Forge" },
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  },
  command: {
    execute: vi.fn(async () => ({ ok: true }) as { ok: boolean } | undefined),
    loading: false,
    error: undefined as { code: string; message: string } | undefined,
    reset: vi.fn(),
  },
}))

vi.mock("@forge-go/dashboard-plugin", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@forge-go/dashboard-plugin"
  )
  return {
    ...actual,
    useQuery: (intent: string) =>
      intent === "auth.setupStatus" ? mocks.status : mocks.config,
    useCommand: () => mocks.command,
  }
})

const { SetupScreen } = await import("../src/auth/screens/setup")

const intents: AuthIntents = {
  config: "auth.config",
  signIn: "auth.login",
  setupStatus: "auth.setupStatus",
  completeSetup: "auth.setup",
}

function LocationProbe() {
  const location = useLocation()
  return (
    <output data-testid="location">{`${location.pathname}${location.search}`}</output>
  )
}

function renderSetup(onAuthenticated = vi.fn()) {
  render(
    <MemoryRouter initialEntries={["/setup?next=%2F"]}>
      <Routes>
        <Route
          element={
            <>
              <SetupScreen
                basename="/forge"
                intents={intents}
                next="/"
                onAuthenticated={onAuthenticated}
              />
              <LocationProbe />
            </>
          }
          path="/setup"
        />
        <Route element={<LocationProbe />} path="/login" />
      </Routes>
    </MemoryRouter>
  )
  return { onAuthenticated }
}

function advanceToAdministrator() {
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to environment" })
  )
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to administrator" })
  )
}

describe("SetupScreen", () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    mocks.status.data = {
      pending: true,
      platform: {
        name: "TwinOS Office",
        slug: "twinos-office",
        logo: "https://example.com/logo.svg",
      },
      environment: {
        name: "Development",
        slug: "development",
        type: "development",
        isDefault: true,
        color: "#2563eb",
        description: "Local development",
      },
    }
    mocks.status.loading = false
    mocks.status.error = undefined
    mocks.status.refetch.mockReset()
    mocks.command.execute.mockReset()
    mocks.command.execute.mockResolvedValue({ ok: true })
    mocks.command.loading = false
    mocks.command.error = undefined
    mocks.command.reset.mockReset()
  })

  it("renders progress, safe defaults, and a resilient logo preview", () => {
    renderSetup()

    expect(screen.getByText("1. Platform").getAttribute("aria-current")).toBe(
      "step"
    )
    expect(screen.getByText("2. Environment")).toBeDefined()
    expect(screen.getByText("3. Administrator")).toBeDefined()
    expect(screen.getByLabelText("Platform name")).toHaveProperty(
      "value",
      "TwinOS Office"
    )
    expect(screen.getByLabelText("Platform slug")).toHaveProperty(
      "value",
      "twinos-office"
    )

    const preview = screen.getByRole("img", { name: "Platform logo preview" })
    fireEvent.error(preview)
    expect(screen.getByTestId("platform-logo-fallback")).toBeDefined()
    expect(screen.getByLabelText("Logo URL")).toHaveProperty(
      "value",
      "https://example.com/logo.svg"
    )
  })

  it("validates the active step and focuses the first invalid field", () => {
    renderSetup()
    const name = screen.getByLabelText("Platform name")
    fireEvent.change(name, { target: { value: "" } })

    fireEvent.click(
      screen.getByRole("button", { name: "Continue to environment" })
    )

    expect(screen.getByText("Enter a name.")).toBeDefined()
    expect(document.activeElement).toBe(name)
  })

  it("advances with form submission, preserves edits on Back, and supports review edits", () => {
    renderSetup()
    fireEvent.change(screen.getByLabelText("Platform name"), {
      target: { value: "Control Room" },
    })

    fireEvent.submit(
      screen
        .getByRole("button", { name: "Continue to environment" })
        .closest("form")!
    )
    expect(screen.getByLabelText("Environment name")).toHaveProperty(
      "value",
      "Development"
    )

    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(screen.getByLabelText("Platform name")).toHaveProperty(
      "value",
      "Control Room"
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Continue to environment" })
    )
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Continue to administrator" })
        .closest("form")!
    )
    fireEvent.click(screen.getByRole("button", { name: "Edit platform" }))
    expect(screen.getByLabelText("Platform name")).toHaveProperty(
      "value",
      "Control Room"
    )
  })

  it("submits the exact nested payload and keeps credentials out of storage and URLs", async () => {
    const { onAuthenticated } = renderSetup()
    advanceToAdministrator()
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: " Rex " },
    })
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: " rex@example.com " },
    })
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse" },
    })
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "correct horse" },
    })

    fireEvent.submit(
      screen.getByRole("button", { name: "Create platform" }).closest("form")!
    )

    await waitFor(() => expect(mocks.command.execute).toHaveBeenCalledOnce())
    expect(mocks.command.execute).toHaveBeenCalledWith({
      email: "rex@example.com",
      password: "correct horse",
      name: "Rex",
      platform: {
        name: "TwinOS Office",
        slug: "twinos-office",
        logo: "https://example.com/logo.svg",
      },
      environment: {
        name: "Development",
        slug: "development",
        type: "development",
        color: "#2563eb",
        description: "Local development",
      },
    })
    expect(onAuthenticated).toHaveBeenCalledOnce()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(screen.getByTestId("location").textContent).toBe("/setup?next=%2F")
  })

  it("uses the administrator-only flow for a minimal setup provider", async () => {
    mocks.status.data = { pending: true }
    renderSetup()

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@example.com" },
    })
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret" },
    })
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Create and continue" })
        .closest("form")!
    )

    await waitFor(() =>
      expect(mocks.command.execute).toHaveBeenCalledWith({
        email: "owner@example.com",
        password: "secret",
      })
    )
  })

  it("redirects completed setup to sign in with the destination intact", () => {
    mocks.status.data = { pending: false }
    renderSetup()

    expect(screen.getByTestId("location").textContent).toBe("/login?next=%2F")
  })

  it("shows a retryable status failure without rendering a form", () => {
    mocks.status.data = undefined
    mocks.status.error = { code: "UNAVAILABLE", message: "offline" }
    renderSetup()

    expect(screen.queryByRole("form")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(mocks.status.refetch).toHaveBeenCalledOnce()
  })

  it("replaces the wizard when another request completes setup first", () => {
    mocks.command.error = {
      code: "PERMISSION_DENIED",
      message: "setup already completed",
    }
    renderSetup()

    expect(
      screen.getByRole("heading", { name: "Setup already completed" })
    ).toBeDefined()
    expect(
      screen
        .getByRole("link", { name: "Continue to sign in" })
        .getAttribute("href")
    ).toBe("/login?next=%2F")
  })

  it("keeps entered values after an ordinary command error", () => {
    mocks.command.error = { code: "INVALID_ARGUMENT", message: "Try again" }
    renderSetup()
    advanceToAdministrator()
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@example.com" },
    })

    expect(screen.getByText("Try again")).toBeDefined()
    expect(screen.getByLabelText("Email")).toHaveProperty(
      "value",
      "owner@example.com"
    )
  })
  it("waits for setup status before choosing a flow", () => {
    mocks.status.data = undefined
    mocks.status.loading = true
    renderSetup()
    expect(
      screen.getByRole("heading", { name: "Preparing setup" })
    ).toBeDefined()
    expect(screen.queryByLabelText("Email")).toBeNull()
  })

  it("requires matching passwords before creating a platform", () => {
    renderSetup()
    advanceToAdministrator()
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@example.com" },
    })
    fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
      target: { value: "example-password" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create platform" }))
    expect(screen.getByText("Passwords must match.")).toBeDefined()
    expect(document.activeElement).toBe(
      screen.getByLabelText("Confirm password")
    )
    expect(mocks.command.execute).not.toHaveBeenCalled()
  })

  it("does not authenticate when a provider declines setup", async () => {
    mocks.status.data = { pending: true }
    mocks.command.execute.mockResolvedValue({ ok: false })
    const { onAuthenticated } = renderSetup()
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@example.com" },
    })
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "example-password" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create and continue" }))
    await waitFor(() => expect(mocks.command.execute).toHaveBeenCalledOnce())
    expect(onAuthenticated).not.toHaveBeenCalled()
  })
  it("reveals collapsed metadata errors and focuses the invalid entry", () => {
    renderSetup()
    fireEvent.click(screen.getByText("Platform metadata"))
    fireEvent.click(screen.getByRole("button", { name: "Add metadata" }))
    fireEvent.click(screen.getByText("Platform metadata"))
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to environment" })
    )
    expect(screen.getByText("Enter a metadata key.")).toBeDefined()
    expect(document.activeElement).toBe(screen.getByLabelText("Metadata key 1"))
    expect(
      screen.getByLabelText("Metadata key 1").closest("details")?.open
    ).toBe(true)
  })
})
