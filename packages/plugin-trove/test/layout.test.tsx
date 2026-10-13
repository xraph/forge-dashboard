import { afterEach, describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import { BucketsPage } from "../src/pages/buckets"
import BrowserPage from "../src/pages/browser"
import { CasPage } from "../src/pages/cas"
import { MiddlewarePage } from "../src/pages/middleware"
import { OverviewPage } from "../src/pages/overview"
import { TransfersPage } from "../src/pages/transfers"
import { HEAD } from "./fixtures"
import { renderPage, stubClient } from "./harness"

const SINGLE = {
  mode: "single",
  stores: [{ name: "default", driver: "local", isDefault: true }],
}

const STATUS = {
  store: "primary",
  driver: "local",
  health: { ok: true, error: null },
  capabilities: {
    multipart: false,
    presign: false,
    range: false,
    serverCopy: false,
    versioning: false,
    notification: false,
    lifecycle: false,
    folders: true,
  },
  config: {
    defaultBucket: "reports",
    chunkSize: 8388608,
    poolSize: 16,
    maxUploadBytes: 67108864,
  },
  flags: [
    {
      name: "encryption",
      configured: true,
      applied: false,
      note: "enable_encryption is set, but the extension never registers the encrypt middleware.",
    },
    { name: "compression", configured: true, applied: true, note: null },
  ],
  etagIsContentHash: false,
  contentSecret: "configured",
  backends: [],
  routingNote: null,
}

const CAS_ON = {
  enabled: true,
  algorithm: "sha256",
  bucket: "cas",
  index: "memory",
  resetsOnRestart: true,
  releaseSupported: false,
}
const CAS_OFF = {
  enabled: false,
  algorithm: null,
  bucket: null,
  index: null,
  resetsOnRestart: false,
  releaseSupported: false,
}
const CAS_LIST = {
  entries: [
    {
      hash: "sha256:aaaa1111",
      storedSize: 4812,
      lastModified: "2026-09-29T08:00:00Z",
      indexed: true,
      refCount: 2,
      pinned: false,
    },
  ],
  nextCursor: "Y3Vyc29yMg",
}

const OBJECTS = {
  objects: [
    {
      key: "readme.txt",
      storedSize: 4812,
      etag: null,
      lastModified: "2026-09-30T11:58:00Z",
      contentType: null,
      storageClass: null,
    },
  ],
  prefixes: [],
  nextCursor: null,
  foldersSupported: true,
  routed: false,
}

afterEach(() => window.history.replaceState(null, "", "/"))

describe("trove pages follow the shared layout", () => {
  it("Overview follows the shared layout", async () => {
    const { container } = renderPage(
      OverviewPage,
      stubClient({ "system.status": STATUS, "stores.list": SINGLE })
    )
    await screen.findByText("Encryption")
    await screen.findByRole("heading", { level: 2, name: "Configuration" })
    expect(layoutViolations(container)).toEqual([])
  })

  it("Buckets follows the shared layout", async () => {
    const { container } = renderPage(
      BucketsPage,
      stubClient({
        "buckets.list": {
          buckets: [{ name: "assets", createdAt: "2026-09-20T10:00:00Z" }],
          createdAtMeaning: "modified",
        },
        "stores.list": SINGLE,
      })
    )
    await screen.findByText("assets")
    expect(layoutViolations(container)).toEqual([])
  })

  it("CAS follows the shared layout", async () => {
    const { container } = renderPage(
      CasPage,
      stubClient({
        "cas.status": CAS_ON,
        "cas.list": CAS_LIST,
        "stores.list": SINGLE,
      })
    )
    await screen.findByText("sha256:aaaa1111")
    expect(layoutViolations(container)).toEqual([])
  })

  it("CAS follows the shared layout when it is off", async () => {
    const { container } = renderPage(
      CasPage,
      stubClient({ "cas.status": CAS_OFF, "stores.list": SINGLE })
    )
    await screen.findByText("CAS is not enabled on this store.")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Middleware follows the shared layout", async () => {
    const { container } = renderPage(
      MiddlewarePage,
      stubClient({
        "middleware.list": {
          registrations: [
            {
              name: "compress",
              direction: "readwrite",
              scope: "global",
              priority: 0,
              matchesWrite: null,
              matchesRead: null,
            },
          ],
          warnings: [],
        },
        "stores.list": SINGLE,
      })
    )
    await screen.findByText("compress")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Transfers follows the shared layout", async () => {
    const { container } = renderPage(
      TransfersPage,
      stubClient({
        "streams.list": {
          streams: [
            {
              id: "str_01",
              direction: "upload",
              bucket: "reports",
              key: "2026/09/big.csv",
              state: "active",
              offset: 3145728,
              totalSize: 10485760,
            },
          ],
          active: 1,
          max: 16,
        },
        "stores.list": SINGLE,
      })
    )
    await screen.findByText("reports/2026/09/big.csv")
    expect(layoutViolations(container)).toEqual([])
  })

  it("Browser follows the shared layout", async () => {
    window.history.replaceState(
      null,
      "",
      "/@trove/buckets/reports?key=readme.txt"
    )
    const { container } = renderPage(
      BrowserPage,
      stubClient({
        "objects.list": OBJECTS,
        "cas.status": CAS_OFF,
        "system.status": STATUS,
        "objects.head": {
          ...HEAD,
          object: { ...HEAD.object, key: "readme.txt" },
        },
      }),
      { bucket: "reports" }
    )
    // The listing row and the inspector's section both carry the key.
    await screen.findByRole("link", { name: "readme.txt" })
    await screen.findByRole("heading", { level: 2, name: "readme.txt" })
    // The resizable group is already the bordered frame around the listing,
    // so a Section in the left pane would double-frame it. Its table stays
    // outside a section.
    expect(
      layoutViolations(container, { allowTablesOutsideSections: true })
    ).toEqual([])
  })
})
