import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { NavigationProvider, mountPath } from "@forge-go/dashboard-plugin"
import type { NavigateOptions, PluginLinkProps } from "@forge-go/dashboard-plugin"
import type { ReactNode } from "react"
import weavePlugin from "../src/index"
import {
  WEAVE_MOUNT,
  chunkPath,
  chunksHref,
  collectionEditPath,
  collectionIngestPath,
  collectionPath,
  documentPath,
  documentsHref,
  useSearchParam,
  useSetSearchParams,
} from "../src/links"

afterEach(() => {
  window.history.replaceState(null, "", "/")
})

describe("links", () => {
  it("start the query-carrying ones at the plugin's real mount point", () => {
    expect(`${WEAVE_MOUNT}/documents`).toBe(mountPath(weavePlugin, "/documents"))
    expect(`${WEAVE_MOUNT}/chunks`).toBe(mountPath(weavePlugin, "/chunks"))
  })

  it("keep paths with no query scope-relative", () => {
    expect(collectionPath("col_1")).toBe("/collections/col_1")
    expect(collectionEditPath("col_1")).toBe("/collections/col_1/edit")
    expect(collectionIngestPath("col_1")).toBe("/collections/col_1/ingest")
    expect(documentPath("doc_1")).toBe("/documents/doc_1")
    expect(chunkPath("chk_1")).toBe("/chunks/chk_1")
  })

  it("put only the filters that are set into the query, in a fixed order", () => {
    expect(documentsHref({})).toBe("/@weave/documents")
    expect(documentsHref({ state: "failed", collection_id: "col_1" })).toBe("/@weave/documents?collection_id=col_1&state=failed")
    expect(documentsHref({ collection_id: "", state: "" })).toBe("/@weave/documents")
    expect(chunksHref("col_1")).toBe("/@weave/chunks?collection_id=col_1")
    expect(chunksHref()).toBe("/@weave/chunks")
  })
})

describe("search params", () => {
  it("reads a param from the address", () => {
    window.history.replaceState(null, "", "/@weave/documents?state=failed")
    const { result } = renderHook(() => useSearchParam("state"))
    expect(result.current).toBe("failed")
  })

  it("sets and clears params through the host, replacing the entry and keeping the others", () => {
    window.history.replaceState(null, "", "/@weave/documents?state=failed&collection_id=col_1")
    const calls: { to: string; options?: NavigateOptions }[] = []
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NavigationProvider
        value={{
          Link: ({ to, children: c }: PluginLinkProps) => <a href={to}>{c}</a>,
          navigate: (to: string, options?: NavigateOptions) => {
            calls.push({ to, options })
            window.history.replaceState(null, "", to)
          },
        }}
      >
        {children}
      </NavigationProvider>
    )
    const { result } = renderHook(() => ({ set: useSetSearchParams("/documents"), state: useSearchParam("state") }), { wrapper })
    act(() => result.current.set({ state: "" }))
    expect(calls).toEqual([{ to: "/@weave/documents?collection_id=col_1", options: { replace: true } }])
    expect(result.current.state).toBe("")
  })
})
