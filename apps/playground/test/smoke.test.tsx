import { describe, expect, it } from "vitest"
import * as app from "../src/App"

// PluginHost and its behavioural tests moved to @forge-go/dashboard-host in
// Task 2 of the Next-embedding work, leaving this directory with nothing to
// build. tsc -b (via tsconfig.test.json's `include: ["test"]`) fails hard
// with "No inputs were found" when a composite project's include list
// matches zero files, which would break `pnpm --filter playground build`
// and the root `turbo build`. This file exists to keep that include
// non-empty, so it's still worth asserting the app entry actually loads.
describe("app entry", () => {
  it("is importable", () => {
    expect(app).toBeTypeOf("object")
  })
})
