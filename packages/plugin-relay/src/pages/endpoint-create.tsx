import { useCommand, useNavigateTo } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  EndpointForm,
  emptyEndpointForm,
  type ParsedEndpoint,
} from "../components/endpoint-form"

interface Ack {
  ok: boolean
  id?: string
}

/** Drops empty optional fields, so the server stores nothing rather than "". */
function createPayload(p: ParsedEndpoint) {
  return {
    tenantId: p.tenantId,
    url: p.url,
    ...(p.description ? { description: p.description } : {}),
    eventTypes: p.eventTypes,
    ...(p.rateLimit !== undefined && p.rateLimit > 0
      ? { rateLimit: p.rateLimit }
      : {}),
    ...(Object.keys(p.headers).length ? { headers: p.headers } : {}),
    ...(Object.keys(p.metadata).length ? { metadata: p.metadata } : {}),
  }
}

export function RelayEndpointCreatePage() {
  const create = useCommand<Ack>("endpoints.create")
  const navigate = useNavigateTo()

  async function submit(parsed: ParsedEndpoint) {
    const result = await create.execute(createPayload(parsed))
    if (result === undefined) return
    // The detail page is where the secret gets rotated and the endpoint
    // switched off, so that is where a new one should land.
    navigate(result.id ? `/endpoints/${result.id}` : "/endpoints")
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="New endpoint"
        description="Relay generates a signing secret for it. Rotate it from the endpoint's page to see it."
      />
      <EndpointForm
        mode="create"
        initial={emptyEndpointForm}
        submitLabel="Create endpoint"
        pendingLabel="Creating…"
        pending={create.loading}
        error={create.error}
        errorTitle="Could not create the endpoint"
        onSubmit={(p) => void submit(p)}
      />
    </section>
  )
}
