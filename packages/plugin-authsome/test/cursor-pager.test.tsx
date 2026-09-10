import { describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react"
import { CursorPager, useCursorStack } from "../src/components/cursor-pager"

describe("useCursorStack", () => {
  it("starts at the beginning with no way back", () => {
    const { result } = renderHook(() => useCursorStack())
    expect(result.current.cursor).toBeUndefined()
    expect(result.current.canGoBack).toBe(false)
  })

  it("walks forward and back through the cursors it was given", () => {
    const { result } = renderHook(() => useCursorStack())

    act(() => result.current.next("c1"))
    expect(result.current.cursor).toBe("c1")
    expect(result.current.canGoBack).toBe(true)

    act(() => result.current.next("c2"))
    expect(result.current.cursor).toBe("c2")

    act(() => result.current.previous())
    expect(result.current.cursor).toBe("c1")

    act(() => result.current.previous())
    // Back at the start, which is `undefined` rather than a cursor: the first
    // page is the one you get by sending no cursor at all.
    expect(result.current.cursor).toBeUndefined()
    expect(result.current.canGoBack).toBe(false)
  })

  it("resets to the first page, which is what a new search has to do", () => {
    const { result } = renderHook(() => useCursorStack())
    act(() => result.current.next("c1"))
    act(() => result.current.next("c2"))
    act(() => result.current.reset())
    expect(result.current.cursor).toBeUndefined()
    expect(result.current.canGoBack).toBe(false)
  })
})

describe("CursorPager", () => {
  it("renders nothing when there is one page and no way back", () => {
    const { container } = render(
      <CursorPager shown={3} total={3} onNext={() => {}} onPrevious={() => {}} canGoBack={false} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("offers Next only while the server says there is more", () => {
    const onNext = vi.fn()
    render(
      <CursorPager
        shown={25}
        total={100}
        nextCursor="c1"
        onNext={onNext}
        onPrevious={() => {}}
        canGoBack={false}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(onNext).toHaveBeenCalledWith("c1")
    expect(
      (screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it("says how many of how many are shown, because a cursor gives no page number", () => {
    render(
      <CursorPager
        shown={25}
        total={100}
        nextCursor="c1"
        onNext={() => {}}
        onPrevious={() => {}}
        canGoBack={false}
      />,
    )
    expect(screen.getByText(/25 of 100/)).toBeTruthy()
  })

  it("omits the total when the server did not send one", () => {
    render(
      <CursorPager shown={25} nextCursor="c1" onNext={() => {}} onPrevious={() => {}} canGoBack={false} />,
    )
    expect(screen.getByText(/25 shown/)).toBeTruthy()
  })
})
