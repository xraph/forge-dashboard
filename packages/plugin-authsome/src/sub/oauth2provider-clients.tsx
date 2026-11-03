import { useState } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { CopyableValue } from "./apikey"
import type { ClientSummary } from "./oauth2provider"

/**
 * Client create, detail, edit, rotate secret and delete.
 *
 * `id` is the internal client id and goes in every input and route. `clientId`
 * is the public OAuth client_id and is only displayed.
 *
 * A client secret appears in exactly two command results, `oauth2.clients.create`
 * and `oauth2.clients.rotateSecret`. It is held in component state and nowhere
 * else, so it never reaches a query cache and is gone once the page unmounts.
 */

export interface ClientDetail extends ClientSummary {
  resources: string[]
  authMethod: string
  dpopMode: string
  updatedAt: string
}

interface CreatedClient {
  id: string
  clientId: string
  clientSecret?: string
}

interface RotatedSecret {
  id: string
  clientId: string
  clientSecret: string
}

interface DeleteResponse {
  ok: boolean
  id: string
}

const DEVICE_CODE = "urn:ietf:params:oauth:grant-type:device_code"

const GRANT_TYPES = [
  { value: "authorization_code", label: "Authorization code" },
  { value: "refresh_token", label: "Refresh token" },
  { value: "client_credentials", label: "Client credentials" },
  { value: DEVICE_CODE, label: "Device code" },
]

function grantLabel(value: string) {
  return GRANT_TYPES.find((g) => g.value === value)?.label ?? value
}

function splitLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function splitScopes(text: string) {
  return text.split(/[\s,]+/).filter(Boolean)
}

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function GrantTypeBoxes({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string
  value: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-2"
      role="group"
      aria-label="Grant types"
    >
      {GRANT_TYPES.map((g) => (
        <div key={g.value} className="flex items-center gap-2">
          <Checkbox
            id={`${idPrefix}-${g.value}`}
            checked={value.includes(g.value)}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...value, g.value]
                  : value.filter((v) => v !== g.value)
              )
            }
          />
          <Label htmlFor={`${idPrefix}-${g.value}`}>{g.label}</Label>
        </div>
      ))}
    </div>
  )
}

function SecretReveal({
  title,
  clientId,
  secret,
  action,
}: {
  title: string
  clientId: string
  secret?: string
  action: React.ReactNode
}) {
  return (
    <Section title={title} inset className="max-w-3xl">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-muted-foreground">Client ID</span>
          <CopyableValue value={clientId} label="client ID" />
        </div>
        {secret ? (
          <>
            <p className="text-sm text-muted-foreground">
              This is the only time you will see the client secret. Copy it now:
              it will not be shown again.
            </p>
            <CopyableValue value={secret} label="client secret" />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            This is a public client, so it has no client secret.
          </p>
        )}
        <div>{action}</div>
      </div>
    </Section>
  )
}

/* ---------------------------------------------------------------- create */

export function OAuth2ClientCreatePage() {
  const create = useCommand<CreatedClient>("oauth2.clients.create")
  const [name, setName] = useState("")
  const [isPublic, setIsPublic] = useState(false)
  const [firstParty, setFirstParty] = useState(false)
  const [redirectUris, setRedirectUris] = useState("")
  const [scopes, setScopes] = useState("openid profile email")
  const [grantTypes, setGrantTypes] = useState<string[]>(["authorization_code"])
  // Local state, not `create.data`: the secret lives exactly as long as this
  // page does and is never put anywhere a refetch could reach it.
  const [created, setCreated] = useState<CreatedClient | null>(null)

  async function submit() {
    const result = await create.execute({
      name: name.trim(),
      public: isPublic,
      firstParty,
      redirectUris: splitLines(redirectUris),
      scopes: splitScopes(scopes),
      grantTypes,
      resources: [],
    })
    if (result === undefined) return
    setCreated(result)
  }

  if (created) {
    return (
      <section className="flex min-w-0 flex-col gap-4">
        <PageHeader title="New OAuth2 client" />
        <SecretReveal
          title="Client created"
          clientId={created.clientId}
          secret={created.clientSecret}
          action={
            <PluginLink
              to={`/auth/oauth2/clients/${created.id}`}
              className="text-sm underline underline-offset-4"
            >
              Open client
            </PluginLink>
          }
        />
      </section>
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader title="New OAuth2 client" />
      <Section title="Client details" inset className="max-w-3xl">
        <div className="flex min-w-0 flex-col gap-4">
          <CommandAlert
            error={create.error}
            title="Could not create the client"
          />
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="oauth2-create-name">Name</Label>
            <Input
              id="oauth2-create-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="oauth2-create-public"
              checked={isPublic}
              onCheckedChange={(c) => setIsPublic(c === true)}
            />
            <Label htmlFor="oauth2-create-public">Public client</Label>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">
            Public clients cannot keep a secret (single-page and mobile apps)
            and are not issued one.
          </p>
          <div className="flex items-center gap-2">
            <Checkbox
              id="oauth2-create-first-party"
              checked={firstParty}
              onCheckedChange={(c) => setFirstParty(c === true)}
            />
            <Label htmlFor="oauth2-create-first-party">First party</Label>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="oauth2-create-redirects">Redirect URIs</Label>
            <Textarea
              id="oauth2-create-redirects"
              value={redirectUris}
              onChange={(e) => setRedirectUris(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">One per line.</p>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="oauth2-create-scopes">Scopes</Label>
            <Input
              id="oauth2-create-scopes"
              value={scopes}
              onChange={(e) => setScopes(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Separated by commas or spaces.
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium">Grant types</span>
            <GrantTypeBoxes
              idPrefix="oauth2-create-grant"
              value={grantTypes}
              onChange={setGrantTypes}
            />
          </div>
          <div>
            <Button
              onClick={() => void submit()}
              disabled={create.loading || name.trim() === ""}
            >
              {create.loading ? "Creating…" : "Create client"}
            </Button>
          </div>
        </div>
      </Section>
    </section>
  )
}

/* ---------------------------------------------------------------- detail */

function EditClientForm({
  client,
  onDone,
}: {
  client: ClientDetail
  onDone: () => void
}) {
  const update = useCommand<unknown>("oauth2.clients.update")
  const [name, setName] = useState(client.name)
  const [redirectUris, setRedirectUris] = useState(
    (client.redirectUris ?? []).join("\n")
  )
  const [scopes, setScopes] = useState((client.scopes ?? []).join(" "))
  const [grantTypes, setGrantTypes] = useState<string[]>(
    client.grantTypes ?? []
  )
  const [resources, setResources] = useState(
    (client.resources ?? []).join("\n")
  )

  // Only fields that differ from the loaded client are sent.
  const changed: Record<string, unknown> = { id: client.id }
  if (name !== client.name) changed.name = name.trim()
  const nextRedirects = splitLines(redirectUris)
  if (!sameList(nextRedirects, client.redirectUris ?? []))
    changed.redirectUris = nextRedirects
  const nextScopes = splitScopes(scopes)
  if (!sameList(nextScopes, client.scopes ?? [])) changed.scopes = nextScopes
  if (!sameList(grantTypes, client.grantTypes ?? []))
    changed.grantTypes = grantTypes
  const nextResources = splitLines(resources)
  if (!sameList(nextResources, client.resources ?? []))
    changed.resources = nextResources
  const dirty = Object.keys(changed).length > 1

  async function submit() {
    const result = await update.execute(changed)
    if (result === undefined) return
    onDone()
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <CommandAlert error={update.error} title="Could not save" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="oauth2-edit-name">Name</Label>
        <Input
          id="oauth2-edit-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="oauth2-edit-redirects">Redirect URIs</Label>
        <Textarea
          id="oauth2-edit-redirects"
          value={redirectUris}
          onChange={(e) => setRedirectUris(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">One per line.</p>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="oauth2-edit-scopes">Scopes</Label>
        <Input
          id="oauth2-edit-scopes"
          value={scopes}
          onChange={(e) => setScopes(e.target.value)}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm font-medium">Grant types</span>
        <GrantTypeBoxes
          idPrefix="oauth2-edit-grant"
          value={grantTypes}
          onChange={setGrantTypes}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="oauth2-edit-resources">Resources</Label>
        <Textarea
          id="oauth2-edit-resources"
          value={resources}
          onChange={(e) => setResources(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">One per line.</p>
      </div>
      <div className="flex gap-2">
        <Button
          onClick={() => void submit()}
          disabled={update.loading || !dirty || name.trim() === ""}
        >
          {update.loading ? "Saving…" : "Save"}
        </Button>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function ClientDetailBody({ id }: { id: string }) {
  const query = useQuery<ClientDetail>("oauth2.clients.detail", { id })
  const rotate = useCommand<RotatedSecret>("oauth2.clients.rotateSecret")
  const del = useCommand<DeleteResponse>("oauth2.clients.delete")
  const navigate = useNavigateTo()
  const [editing, setEditing] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleted, setDeleted] = useState(false)
  // Held in state only, never in the query cache.
  const [rotated, setRotated] = useState<RotatedSecret | null>(null)

  async function confirmRotate() {
    const result = await rotate.execute({ id })
    if (result === undefined) return
    setRotating(false)
    setRotated(result)
  }

  async function confirmDelete() {
    const result = await del.execute({ id })
    if (result === undefined) return
    setDeleted(true)
    navigate("/auth/oauth2")
  }

  if (deleted) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        This client has been deleted.{" "}
        <PluginLink to="/auth/oauth2" className="underline underline-offset-4">
          Back to OAuth2 Provider
        </PluginLink>
      </p>
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <QueryBoundary title="OAuth2 client" query={query} skeletonRows={5}>
        {(client) => (
          <>
            <PageHeader
              title={client.name}
              description={client.clientId}
              actions={
                <div className="flex gap-2">
                  {!client.public && (
                    <Button
                      variant="outline"
                      aria-label="Rotate secret"
                      onClick={() => {
                        rotate.reset()
                        setRotating(true)
                      }}
                    >
                      Rotate secret
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    aria-label={`Delete ${client.name}`}
                    onClick={() => {
                      del.reset()
                      setDeleting(true)
                    }}
                  >
                    Delete
                  </Button>
                </div>
              }
            />
            {rotated && (
              <SecretReveal
                title="Secret rotated"
                clientId={rotated.clientId}
                secret={rotated.clientSecret}
                action={
                  <Button variant="outline" onClick={() => setRotated(null)}>
                    Done
                  </Button>
                }
              />
            )}
            <Section
              title="Details"
              inset
              actions={
                !editing ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(true)}
                  >
                    Edit
                  </Button>
                ) : undefined
              }
            >
              {editing ? (
                <EditClientForm
                  client={client}
                  onDone={() => setEditing(false)}
                />
              ) : (
                <DescriptionList
                  items={[
                    { term: "Name", value: client.name },
                    {
                      term: "Client ID",
                      value: (
                        <span className="font-mono text-xs">
                          {client.clientId}
                        </span>
                      ),
                    },
                    {
                      term: "Type",
                      value: client.public ? (
                        <Badge variant="secondary">Public</Badge>
                      ) : (
                        <Badge variant="default">Confidential</Badge>
                      ),
                    },
                    {
                      term: "First party",
                      value: client.firstParty ? "Yes" : "No",
                    },
                    {
                      term: "Auth method",
                      value: client.authMethod ? (
                        <span className="font-mono text-xs">
                          {client.authMethod}
                        </span>
                      ) : (
                        <NoneCell label="auth method" />
                      ),
                    },
                    {
                      term: "DPoP mode",
                      value: client.dpopMode ? (
                        <span className="font-mono text-xs">
                          {client.dpopMode}
                        </span>
                      ) : (
                        <NoneCell label="DPoP mode" />
                      ),
                    },
                    {
                      term: "Redirect URIs",
                      value: (
                        <TagList
                          values={client.redirectUris ?? []}
                          label="redirect URIs"
                        />
                      ),
                    },
                    {
                      term: "Scopes",
                      value: (
                        <TagList values={client.scopes ?? []} label="scopes" />
                      ),
                    },
                    {
                      term: "Grant types",
                      value: (
                        <TagList
                          values={(client.grantTypes ?? []).map(grantLabel)}
                          label="grant types"
                        />
                      ),
                    },
                    {
                      term: "Resources",
                      value: (
                        <TagList
                          values={client.resources ?? []}
                          label="resources"
                        />
                      ),
                    },
                    {
                      term: "Created",
                      value: (
                        <Timestamp value={client.createdAt} label="created" />
                      ),
                    },
                    {
                      term: "Updated",
                      value: (
                        <Timestamp value={client.updatedAt} label="updated" />
                      ),
                    },
                  ]}
                />
              )}
            </Section>

            <ConfirmDialog
              open={rotating}
              onOpenChange={(open) => !open && setRotating(false)}
              title={`Rotate the secret for ${client.name}?`}
              description="The current secret stops working immediately. Anything still using it will fail to authenticate until it is given the new one."
              confirmLabel="Rotate"
              pending={rotate.loading}
              onConfirm={() => void confirmRotate()}
            >
              <CommandAlert
                title="Could not rotate the secret"
                error={rotate.error}
              />
            </ConfirmDialog>

            <ConfirmDialog
              open={deleting}
              onOpenChange={(open) => !open && setDeleting(false)}
              title={`Delete ${client.name}?`}
              description="Applications using this client lose access immediately. This cannot be undone."
              confirmLabel="Delete"
              pending={del.loading}
              onConfirm={() => void confirmDelete()}
            >
              <CommandAlert
                title="Could not delete the client"
                error={del.error}
              />
            </ConfirmDialog>
          </>
        )}
      </QueryBoundary>
    </section>
  )
}

export function OAuth2ClientDetailPage({ params }: PluginPageProps) {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No client selected.
      </p>
    )
  }
  return <ClientDetailBody id={id} />
}
