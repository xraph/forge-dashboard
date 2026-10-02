import { describe, expect, it } from "vitest"
import { relationGraphPath } from "../src/components/relation-graph-path"

describe("relationGraphPath", () => {
  const base = {
    objectType: "document",
    objectId: "readme",
    relation: "editor",
  }

  it("is the rooted route for an object and a relation", () => {
    expect(relationGraphPath(base)).toBe(
      "/relations/graph/document/readme/editor"
    )
  })

  it("adds the subject for the path route", () => {
    expect(
      relationGraphPath({ ...base, subject: { type: "user", id: "erin" } })
    ).toBe("/relations/graph/document/readme/editor/to/user/erin")
  })

  it("adds a namespace after everything, and none for the root", () => {
    expect(relationGraphPath({ ...base, namespace: "" })).toBe(
      "/relations/graph/document/readme/editor"
    )
    expect(relationGraphPath({ ...base, namespace: "eng/platform" })).toBe(
      "/relations/graph/document/readme/editor/in/eng%2Fplatform"
    )
    expect(
      relationGraphPath({
        ...base,
        subject: { type: "user", id: "erin" },
        namespace: "eng/platform",
      })
    ).toBe(
      "/relations/graph/document/readme/editor/to/user/erin/in/eng%2Fplatform"
    )
  })

  it("encodes every segment, so an id with a slash stays one segment", () => {
    expect(relationGraphPath({ ...base, objectId: "a/b c" })).toBe(
      "/relations/graph/document/a%2Fb%20c/editor"
    )
  })
})
