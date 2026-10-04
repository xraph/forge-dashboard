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
