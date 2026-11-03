import {
  PluginLink,
  defineSubPlugin,
  useQuery,
} from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Section } from "@forge-go/dashboard-kit/components/section"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { ResourceTable, type Column } from "../components/presentation"
import { SETTINGS_INTENTS, settingsPanelFor } from "./settings-panel"

/**
 * The OAuth2 / OIDC provider sub-plugin.
 *
 * Contract intents (authsome `plugins/oauth2provider/contract/`):
 *
 *   oauth2.clients.list                        -> { clients: ClientSummary[] }
 *   oauth2.clients.detail / update / delete    -> keyed by `id`
 *   oauth2.clients.create / rotateSecret       -> the only places a secret appears
 *   oauth2.issuer.info, oauth2.keys.list|rotate
 *
 * `id` is the internal client id and goes in every route and input.
 * `clientId` is the public OAuth client_id and is only ever displayed.
 */

export interface ClientSummary {
  id: string
  clientId: string
  name: string
  public: boolean
  firstParty: boolean
  redirectUris: string[]
  scopes: string[]
  grantTypes: string[]
  createdAt: string
}

export interface ClientListResponse {
  clients: ClientSummary[]
}

function detailPath(id: string) {
  return `/auth/oauth2/clients/${id}`
}

const clientColumns: Column<ClientSummary>[] = [
  {
    id: "name",
    header: "Name",
    className: "font-medium",
    cell: (client) => (
      <PluginLink to={detailPath(client.id)}>{client.name}</PluginLink>
    ),
  },
  {
    id: "clientId",
    header: "Client ID",
    className: "font-mono text-xs",
    cell: (client) => client.clientId,
  },
  {
    id: "type",
    header: "Type",
    cell: (client) =>
      client.public ? (
        <Badge variant="secondary">Public</Badge>
      ) : (
        <Badge variant="default">Confidential</Badge>
      ),
  },
  {
    id: "firstParty",
    header: "First party",
    cell: (client) => (client.firstParty ? "Yes" : "No"),
  },
  {
    id: "createdAt",
    header: "Created",
    cell: (client) => <Timestamp value={client.createdAt} label="created" />,
  },
]

function ClientsSection() {
  const query = useQuery<ClientListResponse>("oauth2.clients.list")
  return (
    <Section
      title="Clients"
      actions={
        <PluginLink
          to="/auth/oauth2/clients/create"
          className="text-sm underline underline-offset-4"
        >
          New client
        </PluginLink>
      }
    >
      <QueryBoundary title="OAuth2 clients" query={query} skeletonRows={5}>
        {(data) => {
          const rows = data.clients ?? []
          const caption = `${rows.length} ${rows.length === 1 ? "client" : "clients"}`
          return (
            <ResourceTable<ClientSummary>
              columns={clientColumns}
              rows={rows}
              rowKey={(client) => client.id}
              caption={caption}
              emptyMessage="No OAuth2 clients yet."
            />
          )
        }}
      </QueryBoundary>
    </Section>
  )
}

/** Placeholder until Task 2 adds the create form. */
function OAuth2ClientCreatePage() {
  return <PageHeader title="New OAuth2 client" />
}

/** Placeholder until Task 2 adds the detail page. */
function OAuth2ClientDetailPage() {
  return <PageHeader title="OAuth2 client" />
}

export function OAuth2OverviewPage() {
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader title="OAuth2 Provider" />
      {/* Task 3 fills the issuer and signing key sections. */}
      <Section title="Issuer" aria-label="Issuer" />
      <Section title="Signing keys" aria-label="Signing keys" />
      <ClientsSection />
    </section>
  )
}

// One instance, shared by the settings tab. See settings-only.tsx.
const OAuth2SettingsPanel = settingsPanelFor(
  "oauth2provider",
  "OAuth2 Provider"
)

export const oauth2providerSubPlugin = defineSubPlugin({
  extension: "oauth2provider",
  host: "authsome",
  label: "OAuth2 Provider",
  nav: [
    {
      label: "OAuth2 Provider",
      to: "/auth/oauth2",
      group: "Authentication",
      priority: 7,
    },
  ],
  routes: [
    { path: "/auth/oauth2", element: OAuth2OverviewPage },
    { path: "/auth/oauth2/clients/create", element: OAuth2ClientCreatePage },
    { path: "/auth/oauth2/clients/:id", element: OAuth2ClientDetailPage },
  ],
  hostIntents: [...SETTINGS_INTENTS],
  contributions: {
    "settings.tabs": [
      {
        id: "oauth2provider",
        label: "OAuth2",
        render: OAuth2SettingsPanel,
      },
    ],
  },
})
