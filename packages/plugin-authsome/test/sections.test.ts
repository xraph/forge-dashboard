import { describe, expect, it } from "vitest"
import { authsomePlugin } from "../src/index"
import { authsomeSubPlugins } from "../src/sub"

describe("authsome sections", () => {
  it("lists its sections in rail order", () => {
    expect(authsomePlugin.sections?.map((section) => section.group)).toEqual([
      "Identity",
      "Authentication",
      "Security",
      "Billing",
      "Compliance",
      "Enterprise",
      "Configuration",
      "System",
    ])
  })

  it("declares a section for every group it and its sub-plugins use, so nothing lands in More", () => {
    const declared = new Set((authsomePlugin.sections ?? []).map((section) => section.group))
    const used = new Set(
      [...authsomePlugin.nav, ...authsomeSubPlugins.flatMap((sub) => sub.nav)]
        .map((item) => item.group)
        .filter((group): group is string => typeof group === "string"),
    )
    expect([...used].filter((group) => !declared.has(group))).toEqual([])
  })

  it("gives every section an icon", () => {
    for (const section of authsomePlugin.sections ?? []) {
      expect(section.icon).toBeTruthy()
    }
  })
})
