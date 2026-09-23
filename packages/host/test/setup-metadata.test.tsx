import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MetadataEditor } from "../src/auth/screens/setup-metadata"
import type { MetadataRow } from "../src/auth/screens/setup-model"

function Harness(errors: Record<string, string> = {}) {
  let nextId = 2
  const rows: MetadataRow[] = [
    { id: "first", key: "region", value: "central" },
    { id: "second", key: "tier", value: "platform" },
  ]
  const onChange = vi.fn()

  render(
    <MetadataEditor
      errors={errors}
      idPrefix="platform-metadata"
      onChange={onChange}
      path="platform.metadata"
      rows={rows}
      createRow={() => ({ id: `new-${nextId++}`, key: "", value: "" })}
    />
  )

  return { onChange, rows }
}

describe("MetadataEditor", () => {
  it("associates labels with every metadata input", () => {
    Harness()

    expect(screen.getByLabelText("Metadata key 1")).toHaveProperty(
      "value",
      "region"
    )
    expect(screen.getByLabelText("Metadata value 2")).toHaveProperty(
      "value",
      "platform"
    )
  })

  it("appends one blank metadata row", () => {
    const { onChange } = Harness()

    fireEvent.click(screen.getByRole("button", { name: "Add metadata" }))

    expect(onChange).toHaveBeenCalledWith([
      { id: "first", key: "region", value: "central" },
      { id: "second", key: "tier", value: "platform" },
      { id: "new-2", key: "", value: "" },
    ])
  })

  it("removes only the selected row", () => {
    const { onChange } = Harness()

    fireEvent.click(
      screen.getByRole("button", { name: "Remove metadata row 1" })
    )

    expect(onChange).toHaveBeenCalledWith([
      { id: "second", key: "tier", value: "platform" },
    ])
  })

  it("renders supplied duplicate-key errors", () => {
    Harness({ "platform.metadata.1.key": "Metadata keys must be unique." })

    expect(screen.getByText("Metadata keys must be unique.")).toBeDefined()
    expect(
      screen.getByLabelText("Metadata key 2").getAttribute("aria-invalid")
    ).toBe("true")
  })
})
