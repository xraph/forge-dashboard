import type { ObjectHead } from "../src/types"

export const HEAD: ObjectHead = {
  object: {
    key: "2026/09/summary.json",
    storedSize: 4812,
    etag: "9f3a01",
    lastModified: "2026-09-30T11:58:00Z",
    contentType: "application/json",
    storageClass: null,
    versionId: null,
    metadata: { owner: "ops", team: "billing" },
  },
  middleware: [
    { name: "compress", direction: "readwrite", scope: "global", priority: 0 },
  ],
  presign: {
    available: false,
    reason: "No share links: this driver cannot sign one.",
  },
}
