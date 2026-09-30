import { afterEach, describe, expect, it, vi } from "vitest"
import { saveFile } from "../src/download"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("saveFile", () => {
  it("saves the content as a file of its type, and never puts it in the page", () => {
    const blobs: Blob[] = []
    vi.stubGlobal("URL", { ...URL, createObjectURL: (b: Blob) => (blobs.push(b), "blob:x"), revokeObjectURL: () => {} })
    const click = vi.fn()
    const create = document.createElement.bind(document)
    const anchors: HTMLAnchorElement[] = []
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = create(tag)
      if (tag === "a") {
        el.click = click
        anchors.push(el as HTMLAnchorElement)
      }
      return el
    })
    saveFile("report-1.html", "text/html; charset=utf-8", "<html><script>alert(1)</script></html>")
    expect(click).toHaveBeenCalledOnce()
    expect(blobs[0].type).toBe("text/html; charset=utf-8")
    expect(anchors[0].download).toBe("report-1.html")
    expect(anchors[0].href).toBe("blob:x")
    expect(document.body.innerHTML).not.toContain("<script>alert(1)</script>")
  })

  it("releases the object URL after the browser has had a turn to start the download", () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    try {
      const revoke = vi.fn()
      vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:y", revokeObjectURL: revoke })
      saveFile("report-1.md", "text/markdown; charset=utf-8", "# x")
      expect(revoke).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(revoke).toHaveBeenCalledWith("blob:y")
    } finally {
      vi.useRealTimers()
    }
  })
})
