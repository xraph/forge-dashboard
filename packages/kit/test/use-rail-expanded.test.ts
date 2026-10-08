import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import {
  RAIL_STORAGE_KEY,
  useRailExpanded,
} from "../src/hooks/use-rail-expanded"

describe("useRailExpanded", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("starts collapsed with nothing stored", () => {
    const { result } = renderHook(() => useRailExpanded())
    expect(result.current.expanded).toBe(false)
  })

  it("starts expanded when that is what was stored", () => {
    window.localStorage.setItem(RAIL_STORAGE_KEY, "expanded")
    const { result } = renderHook(() => useRailExpanded())
    expect(result.current.expanded).toBe(true)
  })

  it("toggles and writes the new state", () => {
    const { result } = renderHook(() => useRailExpanded())
    act(() => result.current.toggle())
    expect(result.current.expanded).toBe(true)
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBe("expanded")
    act(() => result.current.toggle())
    expect(result.current.expanded).toBe(false)
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBe("collapsed")
  })

  it("still toggles when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    const { result } = renderHook(() => useRailExpanded())
    expect(result.current.expanded).toBe(false)
    act(() => result.current.toggle())
    expect(result.current.expanded).toBe(true)
  })
})
