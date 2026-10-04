import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { withStore } from "./store"
import type { ContentLink } from "./types"

/** A failure from the content route itself, with its HTTP status (0 when it never answered). */
export class ContentRouteError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "ContentRouteError"
    this.status = status
  }
}

/**
 * Starts a download. The link is minted here, at the click, because a
 * download ticket lives 60 seconds. A plain anchor with `download` is enough:
 * the route always answers `Content-Disposition: attachment`, and the ticket
 * in `?t=` is what authorises it.
 */
export async function downloadObject(client: ScopedClient, store: string, bucket: string, key: string): Promise<void> {
  const link = await client.query<ContentLink>("objects.contentUrl", withStore(store, { bucket, key, purpose: "download" }))
  const anchor = document.createElement("a")
  anchor.href = link.url
  anchor.setAttribute("download", "")
  anchor.rel = "noopener"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** The most a preview ticket returns. The route stops there. */
export const PREVIEW_LIMIT = 256 * 1024
/** Images larger than this as stored are not fetched for a preview. */
export const IMAGE_PREVIEW_MAX = 4 * 1024 * 1024

const TEXT_TYPES = new Set([
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
  "application/x-ndjson",
  "application/sql",
])

/**
 * Raster types the preview hands to the browser as a Blob behind an object
 * URL. Only these: a `blob:` URL has the dashboard's origin, and opened in a
 * tab of its own it renders as a document there, so a type that can carry
 * script must never take this path.
 */
const RASTER_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
])

/**
 * "image" is a raster type from RASTER_TYPES. "svg" is image/svg+xml, which
 * can carry script and is shown through a `data:` URL instead.
 */
export type PreviewKind = "json" | "text" | "image" | "svg" | "none"

/** What the inspector can show for a content type. */
export function previewKind(contentType: string | null): PreviewKind {
  if (!contentType) return "none"
  const type = contentType.split(";")[0].trim().toLowerCase()
  if (type === "application/json" || type.endsWith("+json")) return "json"
  // Images first: image/svg+xml also ends in +xml, and must stay in an <img>.
  if (type === "image/svg+xml") return "svg"
  if (type.startsWith("image/")) return RASTER_TYPES.has(type) ? "image" : "none"
  if (type.startsWith("text/") || TEXT_TYPES.has(type) || type.endsWith("+xml")) return "text"
  return "none"
}

/**
 * An SVG as a `data:` URL for an <img>. A `data:` URL has an opaque origin,
 * and browsers refuse a top-level navigation to one, so "Open image in new
 * tab" cannot run the SVG's script as the operator. The type is fixed here,
 * never taken from the object's own metadata.
 */
export function svgDataUrl(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ""
  const step = 0x8000
  for (let i = 0; i < view.length; i += step) {
    binary += String.fromCharCode(...view.subarray(i, i + step))
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

/**
 * Fetches bytes from the content route. The route answers JSON
 * `{"error": "..."}` on refusal, which becomes the message. A body that
 * breaks off after the status line arrives as a rejected read, which is a
 * failure, never a short file.
 */
export async function fetchContent(url: string): Promise<ArrayBuffer> {
  let res: Response
  try {
    res = await fetch(url, { credentials: "same-origin", cache: "no-store" })
  } catch {
    throw new ContentRouteError(0, "The content route did not answer.")
  }
  if (!res.ok) {
    let message = `The content route answered ${res.status}.`
    try {
      const body = (await res.json()) as { error?: unknown }
      if (typeof body.error === "string" && body.error !== "") message = body.error
    } catch {
      // Not JSON: keep the status line.
    }
    throw new ContentRouteError(res.status, message)
  }
  try {
    return await res.arrayBuffer()
  } catch {
    throw new ContentRouteError(res.status, "The download broke off before it finished.")
  }
}
