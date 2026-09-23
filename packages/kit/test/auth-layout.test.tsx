import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { AuthLayout } from "../src/components/auth-layout"
import { ThemeProvider } from "../src/components/theme-provider"

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
})) as unknown as typeof window.matchMedia

describe("AuthLayout", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove("light", "dark")
  })

  it("renders the title, description and children", () => {
    render(
      <AuthLayout description="Welcome back." title="Sign in">
        <button type="submit">Continue</button>
      </AuthLayout>
    )
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeDefined()
    expect(screen.getByText("Welcome back.")).toBeDefined()
    expect(screen.getByRole("button", { name: "Continue" })).toBeDefined()
  })

  it("shows Forge identity and the connected server", () => {
    const { container } = render(
      <AuthLayout serverHost="localhost:7901" title="Sign in">
        <div />
      </AuthLayout>
    )
    expect(container.querySelector('[data-slot="forge-mark"]')).not.toBeNull()
    expect(screen.getByText("Connected to")).toBeDefined()
    expect(screen.getByText("localhost:7901")).toBeDefined()
  })

  it("falls back to a default brand when none is given", () => {
    render(
      <AuthLayout title="Sign in">
        <div />
      </AuthLayout>
    )
    expect(screen.getByText("Forge dashboard")).toBeDefined()
  })

  it("uses the given brand", () => {
    render(
      <AuthLayout brand="Platform" title="Sign in">
        <div />
      </AuthLayout>
    )
    expect(screen.getByText("Platform")).toBeDefined()
  })

  it("renders a footer when given one", () => {
    render(
      <AuthLayout
        footer={<a href="/forge/login">Back to sign in</a>}
        title="Reset"
      >
        <div />
      </AuthLayout>
    )
    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeDefined()
  })

  it("keeps the compact width by default and opts into a wider setup surface", () => {
    const { container, rerender } = render(
      <AuthLayout title="Sign in">
        <div />
      </AuthLayout>
    )

    expect(container.querySelector(".max-w-\\[25rem\\]")).not.toBeNull()
    expect(container.querySelector(".max-w-\\[42rem\\]")).toBeNull()

    rerender(
      <AuthLayout size="wide" title="Set up Forge">
        <div />
      </AuthLayout>
    )

    expect(container.querySelector(".max-w-\\[42rem\\]")).not.toBeNull()
  })

  it("switches the shared theme from every auth screen", async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <AuthLayout title="Sign in">
          <div />
        </AuthLayout>
      </ThemeProvider>
    )

    await waitFor(() => {
      expect(document.documentElement.classList.contains("light")).toBe(true)
    })

    fireEvent.click(screen.getByRole("button", { name: "Use dark theme" }))

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true)
    })
    expect(localStorage.getItem("theme")).toBe("dark")
    expect(
      screen.getByRole("button", { name: "Use light theme" })
    ).toBeDefined()
  })

  it("follows the document theme when the host owns the provider", async () => {
    document.documentElement.classList.add("dark")
    render(
      <AuthLayout title="Sign in">
        <div />
      </AuthLayout>
    )

    const toggle = await screen.findByRole("button", {
      name: "Use light theme",
    })
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(document.documentElement.classList.contains("light")).toBe(true)
    })
    expect(localStorage.getItem("theme")).toBe("light")
  })

  it("preserves the theme keyboard shortcut without firing in a field", async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <input aria-label="Email" />
      </ThemeProvider>
    )

    await waitFor(() => {
      expect(document.documentElement.classList.contains("light")).toBe(true)
    })

    fireEvent.keyDown(window, { key: "d" })
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true)
    })

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Email" }), {
      key: "d",
    })
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })
})
