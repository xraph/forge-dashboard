import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { EncryptionBadge } from "../badges"
import { secretPath } from "../keys"

/**
 * Mirrors the Go `SecretSummary`. Field names are its JSON tags. It never
 * carries a value.
 */
export interface SecretSummary {
  id: string
  key: string
  version: number
  /** "" means the value is stored unencrypted. It is always present. */
  encryptionAlg: string
  expiresAt?: string
  appId: string
  metadata?: Record<string, string>
  createdAt: string
  updatedAt: string
}

/** Mirrors the Go `secretsListResponse`. */
export interface SecretsList {
  secrets: SecretSummary[]
  total: number
}

const PAGE_SIZE = 25

function NewSecretLink() {
  return (
    <PluginLink to="/new-secret" className={buttonVariants()}>
      New secret
    </PluginLink>
  )
}

const columns: Column<SecretSummary>[] = [
  {
    id: "key",
    header: "Key",
    className: "font-mono text-xs font-medium",
    cell: (s) => <PluginLink to={secretPath(s.key)}>{s.key}</PluginLink>,
  },
  {
    id: "encryption",
    header: "Encryption",
    cell: (s) => <EncryptionBadge alg={s.encryptionAlg} />,
  },
  {
    id: "version",
    header: "Version",
    className: "font-mono text-xs",
    cell: (s) => `v${s.version}`,
  },
  {
    id: "expires",
    header: "Expires",
    cell: (s) => <Timestamp value={s.expiresAt} label="expiry" />,
  },
  {
    id: "updated",
    header: "Updated",
    cell: (s) => <Timestamp value={s.updatedAt} label="update" />,
  },
]

export const SecretsPage: ComponentType<PluginPageProps> = () => {
  // One-based, matching ResourceTable's PaginationState.
  const [page, setPage] = useState(1)

  const list = useQuery<SecretsList>("secrets.list", {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  })

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Secrets"
        description="Values are write-only: you can set and replace them here, never read them back."
        actions={<NewSecretLink />}
      />

      <QueryBoundary title="Secrets" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.secrets ?? []
          // The server's total, never the page length: a page of 25 out of
          // 31 must not read "25 secrets".
          const caption = `${data.total} ${data.total === 1 ? "secret" : "secrets"}`
          // Only rows on this page count. Nothing is claimed about rows that
          // are not shown, and nothing here says anything is encrypted.
          const anyUnencrypted = rows.some((s) => s.encryptionAlg === "")
          return (
            <>
              {anyUnencrypted && (
                <p className="text-sm text-muted-foreground">
                  Secrets marked Not encrypted were stored while this vault had no
                  encryption key. Adding a key later does not encrypt them; replace
                  their values to re-store them encrypted.
                </p>
              )}
              <ResourceTable<SecretSummary>
                columns={columns}
                rows={rows}
                rowKey={(s) => s.id}
                caption={caption}
                emptyMessage="No secrets yet."
                emptyAction={<NewSecretLink />}
                pagination={{ page, pageSize: PAGE_SIZE, total: data.total }}
                onPageChange={setPage}
              />
            </>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
