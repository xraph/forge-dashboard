import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
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

/**
 * The expiry filter's values, which are the server's: `secrets.list` takes
 * "expired", "7d" or "30d" and refuses anything else. "" is All and is never
 * sent.
 */
export const EXPIRY_FILTERS = [
  { value: "", label: "All" },
  { value: "expired", label: "Expired" },
  { value: "7d", label: "Expires within 7 days" },
  { value: "30d", label: "Expires within 30 days" },
] as const

export type ExpiryFilter = (typeof EXPIRY_FILTERS)[number]["value"]

function isExpiryFilter(v: string): v is ExpiryFilter {
  return EXPIRY_FILTERS.some((f) => f.value === v)
}

/**
 * The overview links here with `?expiry=expired` or `?expiry=30d`. The plugin
 * API hands a page route params and no search string, so, as the audit page
 * does, the search is read from `window.location` once, when the page mounts.
 * A value the select does not offer is dropped rather than sent.
 */
function initialExpiry(): ExpiryFilter {
  try {
    const v = new URLSearchParams(window.location.search).get("expiry") ?? ""
    return isExpiryFilter(v) ? v : ""
  } catch {
    return ""
  }
}

/**
 * Writes the filter back to the address, keeping every other param, so a
 * reload or a copied link lands on the same list. It replaces the entry: a
 * filter is not a place to go back to.
 */
function writeExpiry(next: ExpiryFilter) {
  try {
    const url = new URL(window.location.href)
    if (next === "") url.searchParams.delete("expiry")
    else url.searchParams.set("expiry", next)
    window.history.replaceState(window.history.state, "", url)
  } catch {
    // A page that cannot rewrite its address still filters.
  }
}

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
  // "" is All. It is never sent: an unknown value is BAD_REQUEST, and the
  // server treats an absent one as no filter.
  const [expiry, setExpiry] = useState<ExpiryFilter>(initialExpiry)

  const list = useQuery<SecretsList>("secrets.list", {
    ...(expiry === "" ? {} : { expiry }),
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  })

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Secrets"
        description="Values are write-only: you can set and replace them here, never read them back."
        actions={<NewSecretLink />}
      />

      {/* Outside the boundary, so choosing a filter never takes the control away. */}
      <div className="flex items-center gap-1.5">
        <Label
          htmlFor="secret-expiry-filter"
          className="text-xs text-muted-foreground"
        >
          Expiry
        </Label>
        <NativeSelect
          id="secret-expiry-filter"
          value={expiry}
          onChange={(e) => {
            const next = e.target.value
            const value = isExpiryFilter(next) ? next : ""
            setExpiry(value)
            writeExpiry(value)
            // Page three of "all" is not page three of "expired".
            setPage(1)
          }}
        >
          {EXPIRY_FILTERS.map((f) => (
            <NativeSelectOption key={f.value} value={f.value}>
              {f.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

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
                  Secrets marked Not encrypted were stored while this vault had
                  no encryption key. Adding a key later does not encrypt them;
                  replace their values to re-store them encrypted.
                </p>
              )}
              <ResourceTable<SecretSummary>
                columns={columns}
                rows={rows}
                rowKey={(s) => s.id}
                caption={caption}
                emptyMessage={
                  expiry === ""
                    ? "No secrets yet."
                    : "No secrets match this expiry filter."
                }
                emptyAction={expiry === "" ? <NewSecretLink /> : undefined}
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
