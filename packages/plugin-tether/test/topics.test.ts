import { describe, expect, it } from "vitest"
import { checkFilters, filterProblem, joinFilters } from "../src/topics"

describe("filterProblem", () => {
  it.each([
    "sensors/+/temp",
    "sensors/#",
    "#",
    "+",
    "devices/%c/up",
    "devices/%u/#",
    "a//b",
    "$SYS/broker/load",
  ])("accepts %s", (filter) => {
    expect(filterProblem(filter)).toBeNull()
  })

  it("refuses # anywhere but the last level", () => {
    expect(filterProblem("a/#/b")).toMatch(/# must be the last level/)
  })

  it("refuses # inside a level", () => {
    expect(filterProblem("a/b#")).toMatch(/# must occupy a whole level/)
    expect(filterProblem("a/#b")).toMatch(/# must occupy a whole level/)
  })

  it("refuses + inside a level", () => {
    expect(filterProblem("a/b+/c")).toMatch(/\+ must occupy a whole level/)
    expect(filterProblem("a/+b")).toMatch(/\+ must occupy a whole level/)
  })

  it("refuses a shared-subscription grant, whatever its case", () => {
    expect(filterProblem("$share/g/a/#")).toMatch(/\$share/)
    expect(filterProblem("$SHARE/g/a")).toMatch(/\$share/)
  })

  it("does not mistake a level that merely starts with $share", () => {
    expect(filterProblem("$sharex/a")).toBeNull()
  })
})

describe("checkFilters", () => {
  it("reads one filter per line and drops blank lines and padding", () => {
    expect(checkFilters("  a/b  \n\n c/+ \n")).toEqual({
      filters: ["a/b", "c/+"],
      problems: [],
    })
  })

  it("names the line a problem is on, counting blank lines", () => {
    const out = checkFilters("a/b\n\nc/#/d")
    expect(out.problems).toEqual([
      expect.stringMatching(/^Line 3: .*# must be the last level/),
    ])
  })

  it("is empty for an empty text", () => {
    expect(checkFilters("")).toEqual({ filters: [], problems: [] })
  })
})

describe("joinFilters", () => {
  it("writes one per line", () => {
    expect(joinFilters(["a", "b/#"])).toBe("a\nb/#")
    expect(joinFilters([])).toBe("")
  })
})
