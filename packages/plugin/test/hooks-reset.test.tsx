import { describe, expect, it } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { PluginProvider } from "../src/context"
import { useCommand } from "../src/hooks"
import type { ScopedClient } from "../src/client"

function clientThatFails(): ScopedClient {
  return {
    extension: "test",
    query: async () => ({}) as never,
    command: async () => {
      throw { code: "boom", message: "it broke" }
    },
  } as unknown as ScopedClient
}

function Probe() {
  const cmd = useCommand("thing.do")
  return (
    <div>
      <button onClick={() => void cmd.execute({})}>go</button>
      <button onClick={() => cmd.reset()}>reset</button>
      <span data-testid="err">{cmd.error?.message ?? "none"}</span>
    </div>
  )
}

describe("useCommand reset", () => {
  it("forgets a failure, so the next row does not inherit it", async () => {
    render(
      <PluginProvider client={clientThatFails()}>
        <Probe />
      </PluginProvider>,
    )
    await act(async () => {
      screen.getByText("go").click()
    })
    expect(screen.getByTestId("err").textContent).toBe("it broke")

    await act(async () => {
      screen.getByText("reset").click()
    })
    // Without this, a page holding one command hook for every row shows the
    // previous row's failure inside the next row's confirmation dialog.
    expect(screen.getByTestId("err").textContent).toBe("none")
  })
})
