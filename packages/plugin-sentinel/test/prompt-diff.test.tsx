import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import PromptDiff from "../src/components/prompt-diff"

// test/setup.ts mocks this component for the page tests. This file runs the
// real CodeMirror merge view.
vi.unmock("../src/components/prompt-diff")

describe("PromptDiff", () => {
  const WAS = "You are Nimbus.\nAnswer briefly."
  const NOW = "You are Nimbus.\nAsk for the account email first."

  it("shows the newer prompt, names itself, and draws the older line as removed", () => {
    const { container } = render(<PromptDiff was={WAS} now={NOW} label="Version 1 against version 2" />)
    expect(screen.getByLabelText("Version 1 against version 2")).toBeTruthy()
    expect(container.querySelector(".cm-content")?.textContent).toContain("Ask for the account email first.")
    expect(container.querySelector(".cm-deletedChunk")?.textContent).toContain("Answer briefly.")
  })

  it("draws no removed lines when the two prompts are the same", () => {
    const { container } = render(<PromptDiff was={NOW} now={NOW} label="Same" />)
    expect(container.querySelector(".cm-deletedChunk")).toBeNull()
  })

  it("cannot be edited", () => {
    const { container } = render(<PromptDiff was={WAS} now={NOW} label="Diff" />)
    expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false")
  })
})
