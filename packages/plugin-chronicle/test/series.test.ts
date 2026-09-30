import { describe, expect, it } from "vitest"
import { breakdown, bucketRuns, bucketSeries, emptyBuckets, formatBucket } from "../src/charts/series"

describe("bucketSeries", () => {
  it("lists every hour in the range and keeps an empty hour empty, not zero", () => {
    const s = bucketSeries(
      [
        { bucket: "2026-09-28T02:00:00Z", count: 4 },
        { bucket: "2026-09-28T04:00:00Z", count: 2 },
      ],
      new Date("2026-09-28T02:00:00Z"),
      new Date("2026-09-28T04:59:59Z"),
      "hour",
    )
    expect(s).toEqual([
      { bucket: "2026-09-28T02:00:00Z", count: 4 },
      { bucket: "2026-09-28T03:00:00Z", count: null },
      { bucket: "2026-09-28T04:00:00Z", count: 2 },
    ])
    expect(emptyBuckets(s)).toEqual(["2026-09-28T03:00:00Z"])
  })

  it("buckets days in UTC with the server's format", () => {
    const s = bucketSeries([{ bucket: "2026-09-27", count: 9 }], new Date("2026-09-27T00:00:00Z"), new Date("2026-09-28T23:00:00Z"), "day")
    expect(s.map((x) => x.bucket)).toEqual(["2026-09-27", "2026-09-28"])
    expect(s[1].count).toBeNull()
  })

  it("orders by time whatever order the server returned", () => {
    const s = bucketSeries(
      [
        { bucket: "2026-09-28T01:00:00Z", count: 1 },
        { bucket: "2026-09-28T00:00:00Z", count: 5 },
      ],
      new Date("2026-09-28T00:00:00Z"),
      new Date("2026-09-28T01:00:00Z"),
      "hour",
    )
    expect(s.map((x) => x.count)).toEqual([5, 1])
  })
})

describe("breakdown", () => {
  it("sorts by count descending and names an absent key", () => {
    expect(
      breakdown(
        [
          { category: "auth", count: 3 },
          { category: "data", count: 9 },
          { count: 1 },
        ],
        "category",
      ),
    ).toEqual([
      { label: "data", count: 9 },
      { label: "auth", count: 3 },
      { label: "(none)", count: 1 },
    ])
  })
})

describe("formatBucket", () => {
  it("writes a day as d MMM and an hour as HH:mm, in UTC", () => {
    expect(formatBucket("2026-09-07")).toBe("7 Sep")
    expect(formatBucket("2026-09-28T03:00:00Z")).toBe("03:00")
  })

  it("adds the date to an hour when asked, since 03:00 alone names two hours in a 48 hour view", () => {
    expect(formatBucket("2026-09-28T03:00:00Z", true)).toBe("28 Sep 03:00")
  })
})

describe("bucketRuns", () => {
  const hours = (h: number[]) => h.map((x) => `2026-09-28T${String(x).padStart(2, "0")}:00:00Z`)

  it("joins consecutive empty buckets into one span and leaves a lone one alone", () => {
    expect(bucketRuns(hours([3, 6, 7, 8, 12]), "hour")).toEqual([
      { from: "2026-09-28T03:00:00Z", to: "2026-09-28T03:00:00Z" },
      { from: "2026-09-28T06:00:00Z", to: "2026-09-28T08:00:00Z" },
      { from: "2026-09-28T12:00:00Z", to: "2026-09-28T12:00:00Z" },
    ])
  })

  it("joins consecutive days across a month end", () => {
    expect(bucketRuns(["2026-09-29", "2026-09-30", "2026-10-01"], "day")).toEqual([{ from: "2026-09-29", to: "2026-10-01" }])
  })
})
