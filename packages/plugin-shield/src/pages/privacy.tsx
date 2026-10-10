import { useRef, useState } from "react"
import { useCommand, usePoll, useQuery } from "@forge-go/dashboard-plugin"
import { ListChecks } from "@forge-go/dashboard-kit/icons"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import {
  CoverageNotice,
  IconAction,
  Empty,
  Pager,
  RefreshStatus,
} from "../components/common"
import type { Capabilities, PrivacyPageData, Preview } from "../types"
export function PrivacyPage() {
  const caps = useQuery<Capabilities>("capabilities")
  const [offset, setOffset] = useState(0)
  const q = useQuery<PrivacyPageData>("pii.stats", { limit: 25, offset })
  usePoll(q.refetch)
  const previewCommand = useCommand<Preview>("pii.retentionPreview")
  const purge = useCommand<{ affected: number }>("pii.purge")
  const [preview, setPreview] = useState<Preview>()
  const [message, setMessage] = useState("")
  const busy = useRef(false)
  async function review() {
    if (busy.current) return
    busy.current = true
    previewCommand.reset()
    purge.reset()
    try {
      const result = await previewCommand.execute({})
      if (result) setPreview(result)
    } finally {
      busy.current = false
    }
  }
  async function confirm() {
    if (!preview || busy.current) return
    busy.current = true
    try {
      const result = await purge.execute(
        { preview_id: preview.id },
        { idempotencyKey: `shield-retention-${preview.id}` }
      )
      if (result) {
        setPreview(undefined)
        setMessage(
          `Deleted ${result.affected} expired tokens. The selection was recorded in the audit trail.`
        )
      }
    } finally {
      busy.current = false
    }
  }
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title="PII vault"
        description="Metadata for the authorized tenant. Encrypted and decrypted values are never returned."
        actions={
          caps.data?.can_manage_privacy ? (
            <IconAction
              label="Review expired tokens"
              icon={ListChecks}
              disabled={previewCommand.loading}
              onClick={() => void review()}
            />
          ) : undefined
        }
      />
      <CoverageNotice />
      {caps.data && !caps.data.can_manage_privacy && (
        <p className="text-xs text-muted-foreground">
          Retention requires PII manage permission and a configured audit
          adapter.
        </p>
      )}
      <CommandAlert
        error={previewCommand.error}
        title="Could not preview retention"
      />
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <QueryBoundary title="PII metadata" query={q} keepPreviousData>
        {(page) => (
          <>
            {page.by_type && (
              <div
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-3 py-2 text-xs"
                aria-label="PII type totals"
              >
                <span className="font-medium">
                  {page.total} tokens · {page.distinct_types} types
                </span>
                {Object.entries(page.by_type)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([type, count]) => (
                    <span key={type}>
                      <span className="text-muted-foreground">{type}</span>{" "}
                      {count}
                    </span>
                  ))}
              </div>
            )}
            {page.items.length ? (
              <ResourceTable
                emptyMessage="No records in this scope."
                rows={page.items}
                rowKey={(r) => r.id}
                columns={[
                  {
                    id: "id",
                    header: "Token",
                    className: "font-mono text-xs",
                    cell: (r) => r.id,
                  },
                  {
                    id: "pii_type",
                    header: "Type",
                    cell: (r) => String(r.pii_type),
                  },
                  {
                    id: "placeholder",
                    header: "Placeholder",
                    cell: (r) => String(r.placeholder),
                  },
                  {
                    id: "scan_id",
                    header: "Scan",
                    className: "font-mono text-xs",
                    cell: (r) => String(r.scan_id),
                  },
                  {
                    id: "expiry",
                    header: "Expires",
                    cell: (r) => (
                      <Timestamp
                        value={
                          typeof r.expires_at === "string"
                            ? r.expires_at
                            : undefined
                        }
                        label="expiry"
                      />
                    ),
                  },
                ]}
              />
            ) : (
              <Empty
                title="No PII tokens"
                body="No PII metadata is stored for this tenant."
              />
            )}
            <Pager page={page} onChange={setOffset} />
          </>
        )}
      </QueryBoundary>
      <RefreshStatus query={q} />
      <ConfirmDialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(undefined)
        }}
        title="Delete this expired-token selection?"
        description="This permanently removes only the reviewed token IDs. A new preview is required after five minutes."
        pending={purge.loading}
        confirmDisabled={!preview?.token_ids.length}
        confirmLabel="Delete reviewed tokens"
        onConfirm={() => void confirm()}
      >
        <CommandAlert
          error={purge.error}
          title="Could not delete expired tokens"
        />
        {preview && (
          <div className="grid min-w-0 gap-2 text-xs">
            <p>
              {preview.token_ids.length} selected of {preview.total} expired
              tokens
              {preview.has_more
                ? ". Review another batch after this one completes."
                : "."}
            </p>
            <p>
              Cutoff: <Timestamp value={preview.cutoff} label="cutoff" />
            </p>
            <p>
              Preview expires:{" "}
              <Timestamp value={preview.expires_at} label="preview expiry" />
            </p>
            <div className="max-h-40 overflow-auto rounded-md border p-2 font-mono">
              {preview.token_ids.map((id) => (
                <p key={id}>{id}</p>
              ))}
            </div>
          </div>
        )}
      </ConfirmDialog>
    </section>
  )
}
