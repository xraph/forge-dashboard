import { useState } from "react"
import {
  PluginLink,
  defineSubPlugin,
  useCommand,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"

/**
 * The API key sub-plugin.
 *
 * Verified against `plugins/apikey/contract/`:
 *
 *   apikeys.list                 -> { apiKeys: APIKeySummary[] }   NO input, NO paging
 *   apikeys.detail({ id })       -> APIKeyDetail
 *   apikeys.create({ name, userId, scopes? }) -> { ok, id, keyPrefix, secret }
 *   apikeys.revoke({ id })       -> { ok, id? }
 *
 * There is no delete. `apikeys.revoke` sets a flag on the stored row, and a
 * revoked key keeps its row here and simply loses its Revoke button: hiding a
 * revoked key behind a default filter turns "why is this one greyed out" into
 * "where did my key go", and the second question is worse.
 *
 * `apikeys.create` requires a `userId`. There is no user-picker intent inside
 * this sub-plugin's own contributor, and reaching `users.list` through the
 * host would be exactly the widening `hostIntents` exists to prevent, so the
 * create form asks for a user id as plain text, with help text saying where
 * to find one. Worse UX than a picker, and the honest shape of what this
 * sub-plugin is allowed to see.
 *
 * No `user.detail.sections` contribution. The spec originally promised one
 * and it is blocked: `apikeys.list` takes no input to filter by user, and
 * `APIKeySummary` carries no `userId` to filter on client-side either. Finding
 * one user's keys would mean an `apikeys.detail` call per key in the account,
 * which does not belong in a slot render. That gap is recorded on the
 * migration notes, not built around here.
 */

export interface APIKeySummary {
  id: string
  name: string
  keyPrefix: string
  scopes?: string[]
  revoked: boolean
  expiresAt?: string
  lastUsedAt?: string
  createdAt: string
}

/** `apikeys.detail`. Neither this nor APIKeySummary ever carries a secret. */
export interface APIKeyDetail extends APIKeySummary {
  appId?: string
  envId?: string
  userId?: string
  serviceAccountId?: string
  publicKey?: string
  updatedAt: string
}

/**
 * `apikeys.create`'s response, and the only place the secret ever appears.
 *
 * The stored row keeps only a hash (`KeyHash` is tagged `json:"-"` on the Go
 * side), and neither `APIKeySummary` nor `APIKeyDetail` has a secret field at
 * all. Once this response is handled, the value is genuinely gone.
 */
export interface CreatedKey {
  ok: boolean
  id: string
  keyPrefix: string
  secret: string
}

interface APIKeyListResponse {
  apiKeys: APIKeySummary[]
}

interface RevokeResponse {
  ok: boolean
  id?: string
}

/** Detail page path, matching the manifest's `/apikeys`, no hyphen. */
function detailPath(id: string) {
  return `/@auth/apikeys/${id}`
}

function StatusBadge({ revoked }: { revoked: boolean }) {
  return revoked ? (
    <Badge variant="destructive">revoked</Badge>
  ) : (
    <Badge variant="default">active</Badge>
  )
}

/**
 * "Never" rather than `Timestamp`'s dash for an absent last-use.
 *
 * A dash reading "no last used" is correct but flat for the one column an
 * operator scans specifically to answer "is this key still alive". "Never" is
 * the same fact in the word the question is actually asked in, and it still
 * carries an accessible label rather than relying on the word alone.
 */
function LastUsedCell({ value }: { value?: string }) {
  if (!value) {
    return (
      <span aria-label="never used" className="text-muted-foreground">
        Never
      </span>
    )
  }
  return <Timestamp value={value} label="last used" />
}

/**
 * A value the operator may need to paste somewhere else: the public key on
 * the detail page, and the secret on the create page's one-shot reveal.
 */
function CopyableValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied or unavailable in this context. The
      // value is already on screen and `select-all`, so this is not fatal.
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="select-all font-mono text-xs break-all">{value}</span>
      <Button
        variant="outline"
        size="xs"
        aria-label={`Copy ${label}`}
        onClick={() => void copy()}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </span>
  )
}

/* ------------------------------------------------------------------ list */

export function APIKeyListPage() {
  const query = useQuery<APIKeyListResponse>("apikeys.list")
  const revoke = useCommand<RevokeResponse>("apikeys.revoke")
  const [revoking, setRevoking] = useState<APIKeySummary | null>(null)

  async function confirmRevoke() {
    if (!revoking) return
    const result = await revoke.execute({ id: revoking.id })
    if (result !== undefined) setRevoking(null)
  }

  const columns: Column<APIKeySummary>[] = [
    {
      id: "name",
      header: "Name",
      className: "font-medium",
      cell: (key) => <PluginLink to={detailPath(key.id)}>{key.name}</PluginLink>,
    },
    {
      id: "keyPrefix",
      header: "Prefix",
      className: "font-mono text-xs",
      cell: (key) => `${key.keyPrefix}...`,
    },
    {
      id: "scopes",
      header: "Scopes",
      cell: (key) => <TagList values={key.scopes ?? []} label="scopes" />,
    },
    {
      id: "status",
      header: "Status",
      cell: (key) => <StatusBadge revoked={key.revoked} />,
    },
    {
      id: "createdAt",
      header: "Created",
      cell: (key) => formatTimestamp(key.createdAt),
    },
    {
      id: "lastUsedAt",
      header: "Last used",
      cell: (key) => <LastUsedCell value={key.lastUsedAt} />,
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="API Keys"
        actions={
          <PluginLink to="/@auth/apikeys/create" className="text-sm underline underline-offset-4">
            New API key
          </PluginLink>
        }
      />
      {/*
        apikeys.list takes no input at all and answers its whole collection.
        There is no cursor, no limit and nothing here to page.
      */}
      <QueryBoundary title="API keys" query={query} skeletonRows={5}>
        {(data) => {
          const rows = data.apiKeys ?? []
          const caption = `${rows.length} ${rows.length === 1 ? "API key" : "API keys"}`
          return (
            <ResourceTable<APIKeySummary>
              columns={columns}
              rows={rows}
              rowKey={(key) => key.id}
              caption={caption}
              emptyMessage="No API keys yet."
              rowActions={(key) =>
                !key.revoked ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    aria-label={`Revoke ${key.name}`}
                    onClick={() => {
                      // Reset at open, not at close: one hook serves every
                      // row, so a failure left over from a different key's
                      // revoke must not be attributed to one the operator has
                      // not touched yet.
                      revoke.reset()
                      setRevoking(key)
                    }}
                  >
                    Revoke
                  </Button>
                ) : null
              }
            />
          )
        }}
      </QueryBoundary>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke ${revoking?.name ?? ""}?`}
        description={
          <>
            <span>
              {revoking?.name} immediately loses the ability to authenticate
              with this key. There is no delete and no undo: a replacement
              means minting a new one.
            </span>
            {/*
              Base UI marks everything outside an open dialog inert and
              aria-hidden, so this has to render inside the dialog itself, as
              a <span> rather than CommandAlert's <div>: AlertDialogDescription
              renders a <p>, and a <div> is not valid <p> content.
            */}
            {revoke.error && (
              <span role="alert" className="mt-2 block font-medium text-destructive">
                Could not revoke: {revoke.error.message} ({revoke.error.code})
              </span>
            )}
          </>
        }
        confirmLabel="Revoke"
        pending={revoke.loading}
        onConfirm={() => void confirmRevoke()}
      />
    </section>
  )
}

/* ---------------------------------------------------------------- detail */

function APIKeyDetailBody({ id }: { id: string }) {
  const query = useQuery<APIKeyDetail>("apikeys.detail", { id })

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="API key" query={query} skeletonRows={5}>
        {(key) => (
          <>
            <PageHeader title={key.name} description={`${key.keyPrefix}...`} />
            <DescriptionList
              items={[
                {
                  term: "Key ID",
                  value: <span className="font-mono text-xs">{key.id}</span>,
                },
                {
                  term: "Prefix",
                  value: <span className="font-mono text-xs">{key.keyPrefix}...</span>,
                },
                {
                  term: "Public key",
                  value: key.publicKey ? (
                    <span className="flex flex-col gap-1">
                      <CopyableValue value={key.publicKey} label="public key" />
                      <span className="text-xs text-muted-foreground">
                        Safe to share
                      </span>
                    </span>
                  ) : (
                    <NoneCell label="public key" />
                  ),
                },
                {
                  term: "User",
                  value: key.userId ? (
                    <span className="font-mono text-xs">{key.userId}</span>
                  ) : (
                    <NoneCell label="user" />
                  ),
                },
                {
                  term: "App",
                  value: key.appId ? (
                    <span className="font-mono text-xs">{key.appId}</span>
                  ) : (
                    <NoneCell label="app" />
                  ),
                },
                {
                  term: "Environment",
                  value: key.envId ? (
                    <span className="font-mono text-xs">{key.envId}</span>
                  ) : (
                    <NoneCell label="environment" />
                  ),
                },
                {
                  term: "Scopes",
                  value: <TagList values={key.scopes ?? []} label="scopes" />,
                },
                { term: "Status", value: <StatusBadge revoked={key.revoked} /> },
                {
                  term: "Expires",
                  value: <Timestamp value={key.expiresAt} label="expiry" />,
                },
                { term: "Last used", value: <LastUsedCell value={key.lastUsedAt} /> },
                { term: "Created", value: formatTimestamp(key.createdAt) },
                { term: "Updated", value: formatTimestamp(key.updatedAt) },
              ]}
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}

export function APIKeyDetailPage({ params }: PluginPageProps) {
  const id = params.id

  // A detail route reached without an id is a link somebody built wrong, not
  // a server state, so this says so rather than issuing apikeys.detail with
  // an undefined id and rendering whatever the server makes of that.
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No API key selected.
      </p>
    )
  }

  return <APIKeyDetailBody id={id} />
}

/* ---------------------------------------------------------------- create */

/**
 * The one-shot reveal.
 *
 * The public key is a follow-up `apikeys.detail({ id })` read and must never
 * gate the secret above it: it renders once it arrives and says nothing while
 * in flight, rather than a skeleton eating a fixed part of the panel or, worse,
 * the secret waiting on it.
 */
function RevealedKey({ created, onDismissed }: { created: CreatedKey; onDismissed: () => void }) {
  const detail = useQuery<APIKeyDetail>("apikeys.detail", { id: created.id })
  const [confirmingDismiss, setConfirmingDismiss] = useState(false)

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">API key created</h2>
      <p className="text-sm text-muted-foreground">
        This is the only time you will see the full secret. Copy it now: the
        server keeps only a hash and cannot show it to you again.
      </p>
      <CopyableValue value={created.secret} label="secret" />

      {detail.data?.publicKey && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Public key (safe to share)</span>
          <CopyableValue value={detail.data.publicKey} label="public key" />
        </div>
      )}

      <div>
        <Button onClick={() => setConfirmingDismiss(true)}>Done</Button>
      </div>

      <ConfirmDialog
        open={confirmingDismiss}
        onOpenChange={(open) => !open && setConfirmingDismiss(false)}
        title="Close this panel?"
        description="The secret cannot be recovered once you close this panel. If you lose it, the only way back is to create a new key."
        confirmLabel="Close"
        pending={false}
        onConfirm={onDismissed}
      />
    </div>
  )
}

export function APIKeyCreatePage() {
  const create = useCommand<CreatedKey>("apikeys.create")
  const [name, setName] = useState("")
  const [userId, setUserId] = useState("")
  const [scopes, setScopes] = useState("")

  // Its own state, not read off `create.data`. The reveal panel has to
  // outlive whatever else happens on this page once it is up (the follow-up
  // apikeys.detail read among them), and a settling query resolving into a
  // re-render must never be the thing that decides whether this is still on
  // screen.
  const [revealed, setRevealed] = useState<CreatedKey | null>(null)

  async function submit() {
    const result = await create.execute({
      name,
      userId,
      ...(scopes.trim()
        ? { scopes: scopes.split(",").map((s) => s.trim()).filter(Boolean) }
        : {}),
    })
    if (result === undefined) return
    setRevealed(result)
  }

  if (revealed) {
    return (
      <section className="flex max-w-xl flex-col gap-4">
        <PageHeader title="New API key" />
        <RevealedKey created={revealed} onDismissed={() => setRevealed(null)} />
      </section>
    )
  }

  return (
    <section className="flex max-w-xl flex-col gap-4">
      <PageHeader title="New API key" />
      <CommandAlert error={create.error} title="Could not create the API key" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="apikey-create-name">Name</Label>
        <Input
          id="apikey-create-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="apikey-create-user">User ID</Label>
        <Input
          id="apikey-create-user"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        {/*
          There is no user-picker intent inside this sub-plugin's own
          contributor, and reaching users.list through the host would be
          exactly the widening hostIntents exists to prevent. A plain text
          field with help text is worse UX and the honest shape of what this
          sub-plugin may see.
        */}
        <p className="text-xs text-muted-foreground">
          The user this key authenticates as. Find their id on the user's own
          page; there is no picker here.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="apikey-create-scopes">Scopes</Label>
        <Input
          id="apikey-create-scopes"
          value={scopes}
          onChange={(e) => setScopes(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Comma separated. Leave blank for none.
        </p>
      </div>
      <Button
        onClick={() => void submit()}
        disabled={create.loading || name.trim() === "" || userId.trim() === ""}
      >
        {create.loading ? "Creating…" : "Create key"}
      </Button>
    </section>
  )
}

/* ------------------------------------------------------------ declaration */

export const apikeySubPlugin = defineSubPlugin({
  extension: "apikey",
  host: "auth",
  label: "API Keys",
  nav: [{ label: "API Keys", to: "/apikeys", group: "Security", priority: 1 }],
  routes: [
    { path: "/apikeys", element: APIKeyListPage },
    { path: "/apikeys/create", element: APIKeyCreatePage },
    { path: "/apikeys/:id", element: APIKeyDetailPage },
  ],
  // Reads nothing of its host's. Every intent it uses is its own.
  hostIntents: [],
})
