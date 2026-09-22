import { afterEach, describe, expect, it } from "vitest"
import { createForgeProxy } from "../src/proxy"

const VAR = "FORGE_DASHBOARD_URL"

afterEach(() => {
  delete process.env[VAR]
})

describe("createForgeProxy target resolution", () => {
  it("reads FORGE_DASHBOARD_URL when no target is passed", async () => {
    process.env[VAR] = "https://forge.internal/dashboard"
    let seen = ""
    const { GET } = createForgeProxy({
      fetchImpl: (async (req: Request) => {
        seen = req.url
        return new Response("{}", { status: 200 })
      }) as unknown as typeof fetch,
    })

    await GET(new Request("https://app.test/api/forge/capabilities"), {
      params: Promise.resolve({ path: ["capabilities"] }),
    })

    expect(seen).toBe("https://forge.internal/dashboard/capabilities")
  })

  it("prefers an explicit target over the environment", async () => {
    process.env[VAR] = "https://wrong.internal"
    let seen = ""
    const { GET } = createForgeProxy({
      target: "https://right.internal/dashboard",
      fetchImpl: (async (req: Request) => {
        seen = req.url
        return new Response("{}", { status: 200 })
      }) as unknown as typeof fetch,
    })

    await GET(new Request("https://app.test/api/forge/capabilities"), {
      params: Promise.resolve({ path: ["capabilities"] }),
    })

    expect(seen).toBe("https://right.internal/dashboard/capabilities")
  })

  it("names the variable when neither is set, rather than failing per request", () => {
    // The route module throws while it is still loading, so a missing config
    // is a boot failure with a name in it, not a 500 on every dashboard call.
    expect(() => createForgeProxy({})).toThrow(/FORGE_DASHBOARD_URL/)
  })
})
