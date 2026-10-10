import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import type { ReactNode } from "react"
import { useQuery, usePluginClient } from "@forge-go/dashboard-plugin"
import type { ContractError } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { downloadObject } from "../content"
import { withStore } from "../store"
import type { ObjectHead } from "../types"
import { Bytes } from "./bytes"
import { SettledBoundary } from "./settled-boundary"

function Mono({ value, label }: { value: string | null; label: string }) {
  return value ? (
    <span className="font-mono text-xs break-all">{value}</span>
  ) : (
    <NoneCell label={label} />
  )
}

/**
 * One object, as `objects.head` reports it. `children` renders below the
 * fields with the same head, for the preview and the commands.
 */
export function Inspector({
  store,
  bucket,
  objectKey,
  children,
}: {
  store: string
  bucket: string
  objectKey: string
  children?: (head: ObjectHead) => ReactNode
}) {
  const head = useQuery<ObjectHead>(
    "objects.head",
    withStore(store, { bucket, key: objectKey })
  )

  if (head.error?.code === "NOT_FOUND" && head.data === undefined) {
    return (
      <EmptyState
        title="This object is gone"
        description="Nothing is stored under this key now. It may have been deleted since the listing was read."
      />
    )
  }

  return (
    <SettledBoundary
      title="Could not read this object"
      query={head}
      skeletonRows={6}
    >
      {(data) => (
        <section className="flex min-w-0 flex-col gap-4">
          <h2 className="font-mono text-xs font-medium break-all">
            {data.object.key}
          </h2>
          <InspectorActions
            store={store}
            bucket={bucket}
            objectKey={data.object.key}
          />
          <DescriptionList
            items={[
              {
                term: "Stored size",
                value: <Bytes value={data.object.storedSize} />,
              },
              {
                term: "ETag",
                value: <Mono value={data.object.etag} label="ETag" />,
              },
              {
                term: "Content type",
                value: (
                  <Mono value={data.object.contentType} label="content type" />
                ),
              },
              {
                term: "Storage class",
                value: (
                  <Mono
                    value={data.object.storageClass}
                    label="storage class"
                  />
                ),
              },
              {
                term: "Version",
                value: <Mono value={data.object.versionId} label="version" />,
              },
              {
                term: "Last modified",
                value: (
                  <Timestamp
                    value={data.object.lastModified ?? undefined}
                    label="last modified"
                  />
                ),
              },
              {
                term: "Metadata",
                value:
                  data.object.metadata &&
                  Object.keys(data.object.metadata).length > 0 ? (
                    <TagList
                      label="metadata"
                      values={Object.entries(data.object.metadata)
                        .sort(([a], [b]) => (a < b ? -1 : 1))
                        .map(([k, v]) => `${k}=${v}`)}
                    />
                  ) : (
                    <NoneCell label="metadata" />
                  ),
              },
              {
                term: "Applies now",
                value:
                  data.middleware.length > 0 ? (
                    <TagList
                      label="middleware"
                      values={data.middleware.map((m) => m.name)}
                    />
                  ) : (
                    <span className="text-sm">
                      No middleware matches this key in the current config.
                    </span>
                  ),
              },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            Applies now is what matches this key in the current config. Stored
            size is the bytes as stored. Trove records nothing about how this
            object was written.
          </p>
          {children ? children(data) : null}
        </section>
      )}
    </SettledBoundary>
  )
}

function InspectorActions({
  store,
  bucket,
  objectKey,
}: {
  store: string
  bucket: string
  objectKey: string
}) {
  const client = usePluginClient()
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<
    ContractError | undefined
  >()
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle")

  async function download() {
    setDownloading(true)
    setDownloadError(undefined)
    try {
      await downloadObject(client, store, bucket, objectKey)
    } catch (error) {
      setDownloadError(error as ContractError)
    } finally {
      setDownloading(false)
    }
  }

  async function copyKey() {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard")
      await navigator.clipboard.writeText(objectKey)
      setCopied("copied")
      window.setTimeout(() => setCopied("idle"), 2000)
    } catch {
      setCopied("failed")
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <IconButton
          disabled={downloading}
          onClick={() => void download()}
          label={downloading ? "Starting…" : "Download"}
        />
        <IconButton
          variant="outline"
          onClick={() => void copyKey()}
          label={copied === "copied" ? "Copied" : "Copy key"}
        />
      </div>
      <CommandAlert
        error={downloadError}
        title="Could not start the download"
      />
      {copied === "failed" ? (
        <p className="text-xs text-destructive">
          Copying needs a secure page (HTTPS or localhost) and clipboard
          permission.
        </p>
      ) : null}
    </div>
  )
}
