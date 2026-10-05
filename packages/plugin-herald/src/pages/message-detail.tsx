import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { MessageStatusBadge } from "../badges"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { NO_RECEIPTS } from "../format"
import { messageSendTestPath, providerPath, templatePath } from "../keys"
import type { MessageDetail, MessagesDetailResponse } from "../wire"

function Outcome({ m }: { m: MessageDetail }) {
  if (m.status === "sent") return <p className="text-sm">Accepted by provider. {NO_RECEIPTS}</p>
  if (m.status === "suppressed") return <p className="text-sm">Not sent: the user opted out of this template on this channel.</p>
  if (m.status === "sending") return <p className="text-sm">Handed to the provider and not settled yet.</p>
  return null
}

function TemplateValue({ m }: { m: MessageDetail }) {
  if (m.template) {
    return (
      <PluginLink to={templatePath(m.template.id)} className="font-mono text-xs underline">
        {m.template.slug}
      </PluginLink>
    )
  }
  if (m.templateSlug) {
    return (
      <span>
        <span className="font-mono text-xs">{m.templateSlug}</span> <span className="text-muted-foreground">(no longer exists)</span>
      </span>
    )
  }
  return <NoneCell label="template" />
}

function MessageBody({ id }: { id: string }) {
  const info = useEngineInfo()
  const detail = useQuery<MessagesDetailResponse>("messages.detail", { id })
  const loaded = detail.data?.message
  const limit = info.data?.truncateBodyAt
  return (
    <section className="flex flex-col gap-6">
      {/* Outside the boundary, so loading, failure and not-found still name the app. */}
      <HeraldHeader
        title={loaded ? `Message to ${loaded.recipient}` : "Message"}
        actions={
          loaded && (
            <PluginLink to={messageSendTestPath(loaded.id)} className={buttonVariants({ variant: "outline" })}>
              Send a test to this recipient
            </PluginLink>
          )
        }
      />
      <QueryBoundary title="Message" query={detail} skeletonRows={6}>
        {({ message: m }) => (
          <div className="flex flex-col gap-6">
            <Outcome m={m} />
            {m.error && (
              <section className="flex flex-col gap-1.5">
                <h2 className="text-sm font-medium">Error</h2>
                <pre className="overflow-x-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">{m.error}</pre>
              </section>
            )}
            <DescriptionList
              items={[
                { term: "ID", value: <span className="font-mono text-xs">{m.id}</span> },
                { term: "Recipient", value: m.recipient },
                { term: "Channel", value: m.channel },
                { term: "Status", value: <MessageStatusBadge status={m.status} /> },
                { term: "Template", value: <TemplateValue m={m} /> },
                {
                  term: "Provider",
                  value: m.provider ? (
                    <span>
                      <PluginLink to={providerPath(m.provider.id)} className="underline">
                        {m.provider.name || m.provider.id}
                      </PluginLink>
                      {m.provider.driver && <span className="font-mono text-xs"> {m.provider.driver}</span>}
                    </span>
                  ) : (
                    <NoneCell label="provider" />
                  ),
                },
                { term: "Vendor message ID", value: m.providerMessageId ? <span className="font-mono text-xs">{m.providerMessageId}</span> : <NoneCell label="vendor message ID" /> },
                { term: "Attempts", value: <span className="font-mono text-xs">{m.attempts}</span> },
                { term: "Sent asynchronously", value: m.async ? "Yes" : "No" },
                { term: "Environment", value: m.envId ? <span className="font-mono text-xs">{m.envId}</span> : <NoneCell label="environment" /> },
                { term: "Created", value: <Timestamp value={m.createdAt} label="creation time" /> },
                { term: "Sent", value: <Timestamp value={m.sentAt} label="send time" /> },
              ]}
            />
            <section className="flex flex-col gap-1.5">
              <h2 className="text-sm font-medium">Body</h2>
              {m.subject && <p className="text-sm">Subject: {m.subject}</p>}
              <pre className="overflow-x-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">{m.body}</pre>
              <p className="text-xs text-muted-foreground">
                This is the text part only. HTML bodies aren't logged, and bodies are cut at {limit === undefined ? "the engine's limit" : `${limit} bytes`} with no marker.
              </p>
            </section>
            <section className="flex flex-col gap-1.5">
              <h2 className="text-sm font-medium">Metadata</h2>
              {Object.keys(m.metadata).length === 0 ? (
                <p className="text-sm text-muted-foreground">No metadata.</p>
              ) : (
                <DescriptionList items={Object.entries(m.metadata).map(([term, value]) => ({ term, value: <span className="font-mono text-xs">{value}</span> }))} />
              )}
            </section>
          </div>
        )}
      </QueryBoundary>
    </section>
  )
}

export const MessageDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id
  if (!id) {
    return (
      <section className="flex flex-col gap-6">
        <HeraldHeader title="Message" />
        <p role="status" className="text-sm text-muted-foreground">
          No message ID in the address, so there is nothing to show.
        </p>
      </section>
    )
  }
  return <MessageBody id={id} />
}
