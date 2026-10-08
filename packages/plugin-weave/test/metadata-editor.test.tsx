import { useState } from "react"
import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import {
  MetadataEditor,
  metadataOf,
  rowsOf,
} from "../src/components/metadata-editor"
import type { MetadataRow } from "../src/components/metadata-editor"

describe("metadataOf", () => {
  it("builds a map, skipping fully blank rows", () => {
    expect(
      metadataOf([
        { key: "team", value: "support" },
        { key: "", value: "" },
      ])
    ).toEqual({ metadata: { team: "support" } })
  })

  it("trims keys and refuses a value with no key or a key given twice", () => {
    expect(metadataOf([{ key: " team ", value: "x" }])).toEqual({
      metadata: { team: "x" },
    })
    expect(metadataOf([{ key: "", value: "x" }])).toEqual({
      error: "Every value needs a key.",
    })
    expect(
      metadataOf([
        { key: "a", value: "1" },
        { key: "a", value: "2" },
      ])
    ).toEqual({ error: 'The key "a" appears twice.' })
  })
})

describe("metadataOf and keys that exist on every object", () => {
  it("accepts a key named like an Object.prototype member", () => {
    expect(metadataOf([{ key: "constructor", value: "x" }])).toEqual({
      metadata: { constructor: "x" },
    })
    expect(
      metadataOf([
        { key: "toString", value: "y" },
        { key: "valueOf", value: "z" },
      ])
    ).toEqual({ metadata: { toString: "y", valueOf: "z" } })
  })

  it("keeps a __proto__ key as an own key", () => {
    const result = metadataOf([{ key: "__proto__", value: "x" }])
    if (!("metadata" in result)) throw new Error("expected a metadata map")
    expect(Object.keys(result.metadata)).toContain("__proto__")
    expect(Object.getPrototypeOf(result.metadata)).toBe(Object.prototype)
  })

  it("still refuses one of those keys given twice", () => {
    expect(
      metadataOf([
        { key: "constructor", value: "1" },
        { key: "constructor", value: "2" },
      ])
    ).toEqual({ error: 'The key "constructor" appears twice.' })
  })
})

describe("rowsOf", () => {
  it("sorts by key", () => {
    expect(rowsOf({ b: "2", a: "1" })).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ])
  })
})

function Probe() {
  const [rows, setRows] = useState<MetadataRow[]>([])
  return (
    <div>
      <MetadataEditor rows={rows} onChange={setRows} />
      <output aria-label="result">{JSON.stringify(metadataOf(rows))}</output>
    </div>
  )
}

describe("MetadataEditor", () => {
  it("adds, edits and removes rows", () => {
    render(<Probe />)
    fireEvent.click(screen.getByRole("button", { name: "Add a field" }))
    fireEvent.change(screen.getByLabelText("Metadata key 1"), {
      target: { value: "team" },
    })
    fireEvent.change(screen.getByLabelText("Metadata value 1"), {
      target: { value: "support" },
    })
    expect(screen.getByLabelText("result").textContent).toBe(
      '{"metadata":{"team":"support"}}'
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Remove metadata field 1" })
    )
    expect(screen.getByLabelText("result").textContent).toBe('{"metadata":{}}')
  })
})
