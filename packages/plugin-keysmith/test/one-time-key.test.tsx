import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { OneTimeKey } from "../src/components/one-time-key"
import type { KeySummary } from "../src/types"

// Obviously fake values. A realistic-looking key never goes in a test.
const STANDARD = `sk_live_${"0123456789abcdef".repeat(2)}a3f8`
const CUSTOM = "custom-not-a-standard-key-wxyz"

function summary(over: Partial<KeySummary> = {}): KeySummary {
  return {
    id: "akey_billing",
    name: "Billing service",
    prefix: "sk",
    hint: "a3f8",
    environment: "live",
    state: "active",
    effectiveState: "active",
    expiryPending: false,
    expiresSoon: false,
    scopes: [],
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...over,
  }
}

function part(container: HTMLElement, name: string): HTMLElement | null {
  return container.querySelector(`[data-part="${name}"]`)
}

function renderKey(
  rawKey = STANDARD,
  over: Partial<KeySummary> = {},
  onDone = vi.fn(),
  children?: React.ReactNode
) {
  const view = render(
    <OneTimeKey rawKey={rawKey} summary={summary(over)} onDone={onDone}>
      {children}
    </OneTimeKey>
  )
  return { ...view, onDone }
}

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("OneTimeKey anatomy", () => {
  it("renders no heading when showHeading is false", () => {
    const { rerender } = renderKey()
    expect(screen.getByRole("heading", { name: "Save your new key" })).toBeTruthy()
    rerender(
      <OneTimeKey
        rawKey={STANDARD}
        summary={summary()}
        onDone={vi.fn()}
        showHeading={false}
      />
    )
    expect(screen.queryByRole("heading")).toBeNull()
    // The sentence that says it is the only time stays.
    expect(
      screen.getByText("This is the only time Keysmith will show it.")
    ).toBeTruthy()
  })

  it("says it is the only time", () => {
    renderKey()
    expect(screen.getByText("Save your new key")).toBeTruthy()
    expect(
      screen.getByText("This is the only time Keysmith will show it.")
    ).toBeTruthy()
  })

  it("mutes the prefix, keeps the body, and underlines the last four", () => {
    const { container } = renderKey()
    const prefix = part(container, "prefix")
    const body = part(container, "body")
    const tail = part(container, "tail")
    expect(prefix?.textContent).toBe("sk_live_")
    expect(prefix?.className).toContain("text-muted-foreground")
    expect(body?.textContent).toBe("0123456789abcdef".repeat(2))
    expect(body?.className).not.toContain("text-muted-foreground")
    expect(tail?.textContent).toBe("a3f8")
    expect(tail?.className).toContain("underline")
    expect(part(container, "key")?.textContent).toBe(STANDARD)
  })

  it("shows how the key reads later", () => {
    renderKey()
    expect(screen.getByText("You'll recognise it later as")).toBeTruthy()
    const masked = screen.getByText("sk_live_…a3f8")
    expect(masked.className).toContain("font-mono")
  })

  it("renders a custom-format key whole, underlining only the last four", () => {
    const { container } = renderKey(CUSTOM)
    expect(part(container, "prefix")).toBeNull()
    expect(part(container, "key")?.textContent).toBe(CUSTOM)
    expect(part(container, "body")?.textContent).toBe(CUSTOM.slice(0, -4))
    expect(part(container, "tail")?.textContent).toBe("wxyz")
    expect(part(container, "tail")?.className).toContain("underline")
  })

  it("does not split on underscores when the prefix is not the key's", () => {
    // Starts with sk_live_ but the summary says test: the whole key is the body.
    const { container } = renderKey(STANDARD, { environment: "test" })
    expect(part(container, "prefix")).toBeNull()
    expect(part(container, "key")?.textContent).toBe(STANDARD)
  })

  it("copes with a key shorter than the underline", () => {
    const { container } = renderKey("ab", { prefix: "zz" })
    expect(part(container, "key")?.textContent).toBe("ab")
    expect(part(container, "tail")?.textContent).toBe("ab")
  })

  it("renders children under the key", () => {
    renderKey(STANDARD, {}, vi.fn(), <p>Window list</p>)
    expect(screen.getByText("Window list")).toBeTruthy()
  })
})

describe("OneTimeKey copy", () => {
  it("copies the exact value and says Copied", async () => {
    renderKey()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }))
    })
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(STANDARD)
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy()
  })

  it("goes back to Copy after two seconds", async () => {
    vi.useFakeTimers()
    renderKey()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }))
    })
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(1999)
    })
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy()
  })

  it("clears the copied timer on unmount", async () => {
    vi.useFakeTimers()
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const { unmount } = renderKey()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }))
    })
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    errors.mockRestore()
  })

  it("tells browser translation to leave the key alone", () => {
    const { container } = renderKey()
    expect(part(container, "key")?.getAttribute("translate")).toBe("no")
  })

  it("keeps the text selectable and offers Select and copy when the clipboard fails", async () => {
    writeText.mockRejectedValue(new Error("denied"))
    const { container } = renderKey()
    expect(part(container, "key")?.className).toContain("select-all")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }))
    })
    expect(screen.getByRole("button", { name: "Select and copy" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull()
    expect(part(container, "key")?.className).toContain("select-all")
  })

  it("fails the same way when there is no clipboard at all", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    })
    renderKey()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }))
    })
    expect(screen.getByRole("button", { name: "Select and copy" })).toBeTruthy()
  })
})

describe("OneTimeKey copy fallback", () => {
  const FAILED = "Couldn't copy. The key is selected: press Ctrl+C or Cmd+C."

  function status(): HTMLElement {
    return screen.getByRole("status")
  }

  async function clickCopy(name = "Copy") {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name }))
    })
  }

  it("announces success in a polite, visually hidden live region", async () => {
    renderKey()
    expect(status().getAttribute("aria-live")).toBe("polite")
    expect(status().className).toContain("sr-only")
    expect(status().textContent).toBe("")
    await clickCopy()
    expect(status().textContent).toBe("Copied to clipboard")
    expect(status().textContent).not.toContain(STANDARD)
  })

  it("announces failure without ever containing the key", async () => {
    writeText.mockRejectedValue(new Error("denied"))
    renderKey()
    await clickCopy()
    expect(status().textContent).toBe(FAILED)
    expect(status().textContent).not.toContain(STANDARD)
    expect(status().textContent).not.toContain("0123456789abcdef")
  })

  it("selects the key after a failed copy", async () => {
    writeText.mockRejectedValue(new Error("denied"))
    renderKey()
    await clickCopy()
    expect(window.getSelection()?.toString()).toBe(STANDARD)
  })

  it("shows a hidden key again and selects it when the copy fails", async () => {
    writeText.mockRejectedValue(new Error("denied"))
    const { container } = renderKey()
    fireEvent.click(screen.getByRole("button", { name: "Hide" }))
    expect(part(container, "key")?.textContent).toBe("••••")
    await clickCopy()
    expect(part(container, "key")?.textContent).toBe(STANDARD)
    expect(screen.getByRole("button", { name: "Hide" })).toBeTruthy()
    expect(window.getSelection()?.toString()).toBe(STANDARD)
  })

  it("selects again when Select and copy is clicked in the failed state", async () => {
    writeText.mockRejectedValue(new Error("denied"))
    const { container } = renderKey()
    await clickCopy()
    fireEvent.click(screen.getByRole("button", { name: "Hide" }))
    window.getSelection()?.removeAllRanges()
    await clickCopy("Select and copy")
    expect(part(container, "key")?.textContent).toBe(STANDARD)
    expect(window.getSelection()?.toString()).toBe(STANDARD)
  })

  it("does not let Copied mask a later failure", async () => {
    vi.useFakeTimers()
    renderKey()
    await clickCopy()
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy()
    writeText.mockRejectedValue(new Error("denied"))
    act(() => {
      vi.advanceTimersByTime(500)
    })
    await clickCopy("Copied")
    expect(screen.getByRole("button", { name: "Select and copy" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull()
    expect(status().textContent).toBe(FAILED)
    // The success timer must not fire later and undo the failure label.
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByRole("button", { name: "Select and copy" })).toBeTruthy()
  })

  it("starts no timer when a copy resolves after unmount", async () => {
    vi.useFakeTimers()
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    let resolve!: () => void
    writeText.mockReturnValue(
      new Promise<void>((r) => {
        resolve = r
      })
    )
    const { unmount } = renderKey()
    fireEvent.click(screen.getByRole("button", { name: "Copy" }))
    unmount()
    await act(async () => {
      resolve()
    })
    expect(vi.getTimerCount()).toBe(0)
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})

describe("OneTimeKey hide", () => {
  it("masks the key and keeps the recognisable form visible", () => {
    const { container } = renderKey()
    const toggle = screen.getByRole("button", { name: "Hide" })
    expect(toggle.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-pressed")).toBe("true")
    expect(container.textContent).not.toContain("0123456789abcdef")
    expect(screen.getByText("Key hidden").className).toContain("sr-only")
    expect(
      part(container, "key")?.querySelector("[aria-hidden='true']")?.textContent
    ).toBe("••••")
    expect(part(container, "key")?.textContent).toBe("••••")
    expect(screen.getByText("sk_live_…a3f8")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Show" }))
    expect(part(container, "key")?.textContent).toBe(STANDARD)
  })

  it("still copies the real key while hidden", async () => {
    renderKey()
    fireEvent.click(screen.getByRole("button", { name: "Hide" }))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }))
    })
    expect(writeText).toHaveBeenCalledWith(STANDARD)
  })
})

describe("OneTimeKey done", () => {
  it("stays disabled until the acknowledgement is ticked", () => {
    const { onDone } = renderKey()
    const done = screen.getByRole("button", {
      name: "Done",
    }) as HTMLButtonElement
    expect(done.disabled).toBe(true)
    fireEvent.click(done)
    expect(onDone).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I've stored this key somewhere safe",
      })
    )
    expect(done.disabled).toBe(false)
    fireEvent.click(done)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it("disables Done again when the tick is removed", () => {
    renderKey()
    const box = screen.getByRole("checkbox", {
      name: "I've stored this key somewhere safe",
    })
    fireEvent.click(box)
    fireEvent.click(box)
    expect(
      (screen.getByRole("button", { name: "Done" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
  })
})

describe("OneTimeKey leaving the page", () => {
  it("prevents unload while mounted and not after unmount", () => {
    const { unmount } = renderKey()
    const during = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(during)
    expect(during.defaultPrevented).toBe(true)

    unmount()
    const after = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })
})
