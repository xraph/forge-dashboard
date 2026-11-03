import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { ResourceTable, type Column } from "../components/presentation"
import { CopyableValue } from "./apikey"

/**
 * The Issuer and Signing keys sections of the OAuth2 Provider overview.
 *
 *   oauth2.issuer.info  {}  -> IssuerInfoResponse
 *   oauth2.keys.list    {}  -> KeyListResponse
 *   oauth2.keys.rotate  {}  -> KeyListResponse (after rotation)
 */

export interface IssuerInfoResponse {
  issuer: string
  discoveryUrl: string
  jwksUri: string
  appIssuer: boolean
  algs: string[]
}

export interface SigningKey {
  kid: string
  alg: string
  source: "operator" | "managed"
  status: "active" | "previous" | "retiring"
  createdAt: string
  retiresAt?: string
}

export interface KeyListResponse {
  issuer: string
  keys: SigningKey[]
}

export function IssuerSection() {
  const query = useQuery<IssuerInfoResponse>("oauth2.issuer.info")
  return (
    <Section title="Issuer" aria-label="Issuer">
      <QueryBoundary title="OAuth2 issuer" query={query} skeletonRows={3}>
        {(info) => (
          <div className="flex flex-col gap-3">
            <DescriptionList
              items={[
                {
                  term: "Issuer",
                  value: <CopyableValue value={info.issuer} label="issuer" />,
                },
                {
                  term: "Discovery URL",
                  value: (
                    <CopyableValue
                      value={info.discoveryUrl}
                      label="discovery URL"
                    />
                  ),
                },
                {
                  term: "JWKS URI",
                  value: (
                    <CopyableValue value={info.jwksUri} label="JWKS URI" />
                  ),
                },
                {
                  term: "Mode",
                  value: info.appIssuer ? (
                    <Badge variant="default">Per-app issuer</Badge>
                  ) : (
                    <Badge variant="secondary">Deployment issuer</Badge>
                  ),
                },
                {
                  term: "Signing algorithms",
                  value: (
                    <TagList values={info.algs ?? []} label="algorithms" />
                  ),
                },
              ]}
            />
            <p className="text-sm text-muted-foreground">
              Switch between a per-app and a deployment issuer with the
              &ldquo;Per-app OIDC issuer&rdquo; setting, in the &ldquo;OpenID
              Connect&rdquo; category of the OAuth2 tab in Settings.
            </p>
          </div>
        )}
      </QueryBoundary>
    </Section>
  )
}

const STATUS_VARIANT = {
  active: "default",
  previous: "secondary",
  retiring: "outline",
} as const

const keyColumns: Column<SigningKey>[] = [
  {
    id: "kid",
    header: "Key ID",
    className: "max-w-48 truncate font-mono text-xs",
    cell: (key) => <span title={key.kid}>{key.kid}</span>,
  },
  { id: "alg", header: "Algorithm", cell: (key) => key.alg },
  {
    id: "source",
    header: "Source",
    cell: (key) =>
      key.source === "operator" ? "Managed by configuration" : "Managed",
  },
  {
    id: "status",
    header: "Status",
    cell: (key) => (
      <Badge variant={STATUS_VARIANT[key.status] ?? "outline"}>
        {key.status}
      </Badge>
    ),
  },
  {
    id: "createdAt",
    header: "Created",
    cell: (key) => <Timestamp value={key.createdAt} label="created" />,
  },
  {
    id: "retiresAt",
    header: "Retires",
    cell: (key) =>
      key.retiresAt ? (
        <Timestamp value={key.retiresAt} label="retires" />
      ) : (
        <NoneCell label="retirement" />
      ),
  },
]

export function KeysSection() {
  const keys = useQuery<KeyListResponse>("oauth2.keys.list")
  const info = useQuery<IssuerInfoResponse>("oauth2.issuer.info")
  const rotate = useCommand<KeyListResponse>("oauth2.keys.rotate")
  const [confirming, setConfirming] = useState(false)

  // Per-app issuer is on unless issuer info says otherwise. While it loads we
  // treat rotation as unavailable rather than offering a button that may fail.
  const appIssuer = info.data?.appIssuer
  const shared = appIssuer === false

  async function confirmRotate() {
    const result = await rotate.execute({})
    if (result === undefined) return
    setConfirming(false)
  }

  async function createFirst() {
    await rotate.execute({})
  }

  return (
    <Section title="Signing keys" aria-label="Signing keys">
      <QueryBoundary title="signing keys" query={keys} skeletonRows={3}>
        {(data) => {
          const rows = data.keys ?? []
          const active = rows.find((key) => key.status === "active")
          const operator = active?.source === "operator"
          let reason: string | null = null
          if (operator) {
            reason =
              "The signing key for this issuer is managed by configuration, so it cannot be rotated here."
          } else if (shared) {
            reason =
              "The deployment issuer's signing key is shared by every app and rotates on its own schedule."
          }

          if (rows.length === 0) {
            return (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  No signing key exists yet. The first key is created the first
                  time a client makes an openid request.
                </p>
                {appIssuer ? (
                  <div>
                    <Button
                      variant="outline"
                      disabled={rotate.loading}
                      onClick={() => {
                        rotate.reset()
                        void createFirst()
                      }}
                    >
                      Create key now
                    </Button>
                  </div>
                ) : (
                  appIssuer === false && (
                    <p className="text-sm text-muted-foreground">{reason}</p>
                  )
                )}
                <CommandAlert
                  title="Could not create a key"
                  error={rotate.error}
                />
              </div>
            )
          }

          return (
            <div className="flex flex-col gap-3">
              <ResourceTable<SigningKey>
                columns={keyColumns}
                rows={rows}
                rowKey={(key) => key.kid}
                caption={`${rows.length} ${rows.length === 1 ? "key" : "keys"}`}
                emptyMessage="No signing keys."
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  disabled={reason !== null || appIssuer === undefined}
                  onClick={() => {
                    rotate.reset()
                    setConfirming(true)
                  }}
                >
                  Rotate now
                </Button>
                {reason && (
                  <p className="text-sm text-muted-foreground">{reason}</p>
                )}
              </div>
              <ConfirmDialog
                open={confirming}
                onOpenChange={(open) => !open && setConfirming(false)}
                title="Rotate the signing key?"
                description="A new key signs every token from now on. The old key stays published in the JWKS for its grace period (7 days by default), so tokens already issued keep verifying."
                confirmLabel="Rotate"
                pending={rotate.loading}
                onConfirm={() => void confirmRotate()}
              >
                <CommandAlert
                  title="Could not rotate the key"
                  error={rotate.error}
                />
              </ConfirmDialog>
            </div>
          )
        }}
      </QueryBoundary>
    </Section>
  )
}
