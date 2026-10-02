import { describe, expect, it } from "vitest"
import { formatBytes, humanBytes } from "../src/format"

describe("formatBytes", () => {
  it("gives the exact byte count with grouping", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(4812)).toBe("4,812 B")
    expect(formatBytes(67108864)).toBe("67,108,864 B")
  })
})

describe("humanBytes", () => {
  it("uses binary units with one decimal below ten", () => {
    expect(humanBytes(512)).toBe("512 B")
    expect(humanBytes(4812)).toBe("4.7 KiB")
    expect(humanBytes(67108864)).toBe("64 MiB")
    expect(humanBytes(1536 * 1024 * 1024)).toBe("1.5 GiB")
  })
})
