import { Suspense, lazy, useEffect, useState } from "react"
import { usePluginClient } from "@forge-go/dashboard-plugin"
import { Spinner } from "@forge-go/dashboard-kit/components/spinner"
import {
  ContentRouteError,
  IMAGE_PREVIEW_MAX,
  PREVIEW_LIMIT,
  fetchContent,
  previewKind,
  svgDataUrl,
} from "../content"
import { withStore } from "../store"
import type { ContentLink, ObjectHead } from "../types"

const CodeView = lazy(() => import("./code-view"))

type State =
  | { status: "loading" }
  | { status: "text"; text: string; cut: boolean }
  | { status: "image"; url: string }
  | { status: "error"; message: string }

function messageOf(error: unknown): string {
  if (error instanceof ContentRouteError) return error.message
  if (error instanceof Error && error.message !== "") return error.message
  return "The preview could not be loaded."
}

/**
 * A look at the object's bytes. Text through a preview ticket, capped at
 * 256 KiB by the route, rendered by CodeMirror. Images through a download
 * ticket, shown in an <img>: a raster type from a Blob behind an object URL,
 * an SVG through a `data:` URL. An SVG never gets an object URL, because a
 * `blob:` URL opened in its own tab is a document on the dashboard's origin
 * and its script would run as the operator. Nothing is ever shown inline from
 * the content route. The parent keys this by ETag, so a replaced object is
 * fetched again.
 */
export function Preview({
  store,
  bucket,
  head,
}: {
  store: string
  bucket: string
  head: ObjectHead
}) {
  const kind = previewKind(head.object.contentType)
  const picture = kind === "image" || kind === "svg"
  const tooBig = picture && head.object.storedSize > IMAGE_PREVIEW_MAX
  const fetches = kind !== "none" && !tooBig
  const client = usePluginClient()
  const [state, setState] = useState<State>({ status: "loading" })
  const key = head.object.key

  useEffect(() => {
    if (!fetches) return
    let cancelled = false
    let objectUrl: string | null = null
    void (async () => {
      try {
        const purpose = picture ? "download" : "preview"
        const link = await client.query<ContentLink>(
          "objects.contentUrl",
          withStore(store, { bucket, key, purpose })
        )
        const bytes = await fetchContent(link.url)
        if (cancelled) return
        if (kind === "svg") {
          setState({ status: "image", url: svgDataUrl(bytes) })
          return
        }
        if (kind === "image") {
          objectUrl = URL.createObjectURL(
            new Blob([bytes], {
              type: head.object.contentType ?? "application/octet-stream",
            })
          )
          setState({ status: "image", url: objectUrl })
          return
        }
        const cut = bytes.byteLength >= PREVIEW_LIMIT
        let text = new TextDecoder("utf-8").decode(bytes)
        if (kind === "json" && !cut) {
          try {
            text = JSON.stringify(JSON.parse(text), null, 2)
          } catch {
            // Not valid JSON: show it as it came.
          }
        }
        setState({ status: "text", text, cut })
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: messageOf(error) })
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl)
    }
  }, [
    fetches,
    kind,
    picture,
    client,
    store,
    bucket,
    key,
    head.object.contentType,
  ])

  let body
  if (kind === "none") {
    body = (
      <p className="text-sm text-muted-foreground">
        {head.object.contentType === null
          ? "No preview: the driver reports no content type."
          : "No preview for this content type."}
      </p>
    )
  } else if (tooBig) {
    body = (
      <p className="text-sm text-muted-foreground">
        This image is over 4 MiB as stored. Download it to see it.
      </p>
    )
  } else if (state.status === "loading") {
    body = <Spinner />
  } else if (state.status === "error") {
    body = <p className="text-sm text-destructive">{state.message}</p>
  } else if (state.status === "image") {
    body = (
      <img
        src={state.url}
        alt={`Preview of ${key}`}
        className="max-h-96 max-w-full rounded-md border"
      />
    )
  } else {
    body = (
      <div className="flex min-w-0 flex-col gap-1">
        {state.cut ? (
          <p className="text-xs text-muted-foreground">
            Showing the first 256 KiB.
          </p>
        ) : null}
        <Suspense
          fallback={
            <pre className="max-h-96 overflow-auto rounded-md border p-3 font-mono text-xs">
              {state.text}
            </pre>
          }
        >
          <CodeView
            text={state.text}
            language={kind === "json" ? "json" : "text"}
            label={`Preview of ${key}`}
          />
        </Suspense>
      </div>
    )
  }

  return (
    <section aria-label="Preview" className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-medium">Preview</h3>
      {body}
    </section>
  )
}
