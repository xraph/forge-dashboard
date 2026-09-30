import type { ComponentType, ReactNode } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import { KeyStateBadge } from "../badges"
import { formatDuration, maskedKey } from "../format"
import type { KeyDetail } from "../types"

/**
 * The detail page for one key. Read-only in this slice.
 *
 * `params.id` is split off so a missing id renders a status line before the
 * body's hook runs: a query with no id would ask the server about a key
 * called "".
 */
export const KeyDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No key id in the address, so there is nothing to show.
      </p>
    )
  }
  return <KeyDetailBody id={id} />
}

function KeyDetailBody({ id }: { id: string }) {
  const detail = useQuery<KeyDetail>("keys.detail", { id })

  return (
    <div className="flex flex-col gap-4">
      <QueryBoundary title="Key" query={detail} skeletonRows={4}>
        {(data) => <KeyDetailView data={data} />}
      </QueryBoundary>
      {detail.error?.code === "NOT_FOUND" && (
        <div>
          <PluginLink
            to="/keys"
            className={buttonVariants({ variant: "outline" })}
          >
            Back to keys
          </PluginLink>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  )
}

function KeyDetailView({ data }: { data: KeyDetail }) {
  const { key } = data
  const expiredUnmarked = key.effectiveState === "expired" && key.expiryPending

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <PageHeader title={key.name} description={key.description} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm">{maskedKey(key)}</span>
          <KeyStateBadge summary={key} />
        </div>
        {expiredUnmarked && (
          <p className="text-sm text-muted-foreground">
            {key.expiresAt ? `Expired on ${formatTimestamp(key.expiresAt)}.` : "Expired."}{" "}
            Keysmith marks expiry when the key is next used, so its recorded
            state is still active.
          </p>
        )}
      </div>
      <DetailLayout
        main={
          <>
            <ValiditySection data={data} />
            <DetailsSection data={data} />
            <Section title="Scopes">
              <TagList values={key.scopes ?? []} label="scopes" />
            </Section>
            <MetadataSection metadata={data.metadata} />
          </>
        }
        aside={
          <>
            <PolicySection policy={data.policy} />
            <Section title="Warden">
              <p className="text-sm text-muted-foreground">
                Warden grants this key&apos;s permissions as subject{" "}
                <span className="font-mono text-xs text-foreground">
                  api_key:{key.id}
                </span>
                .
              </p>
            </Section>
          </>
        }
      />
    </section>
  )
}

function ValiditySection({ data }: { data: KeyDetail }) {
  const { key } = data
  const previous = data.previousKeys ?? []
  return (
    <Section title="Validity">
      {previous.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No previous key is still accepted.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {previous.map((p) => (
              <li
                key={p.rotationId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm"
              >
                <span className="font-mono text-xs">
                  {maskedKey({
                    prefix: key.prefix,
                    environment: key.environment,
                    hint: p.hint,
                  })}
                </span>
                <span className="text-muted-foreground">valid until</span>
                <Timestamp value={p.graceEnds} label="cutoff" />
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            Both the current key and this previous key are accepted until then.
          </p>
        </>
      )}
    </Section>
  )
}

function DetailsSection({ data }: { data: KeyDetail }) {
  const { key } = data
  return (
    <Section title="Details">
      <DescriptionList
        items={[
          { term: "ID", value: <span className="font-mono text-xs">{key.id}</span> },
          { term: "Prefix", value: <span className="font-mono text-xs">{key.prefix}</span> },
          { term: "Environment", value: key.environment },
          {
            term: "Created by",
            value: key.createdBy ? key.createdBy : <NoneCell label="creator" />,
          },
          { term: "Created", value: <Timestamp value={key.createdAt} label="creation time" /> },
          { term: "Updated", value: <Timestamp value={key.updatedAt} label="update time" /> },
          { term: "Last used", value: <Timestamp value={key.lastUsedAt} label="recorded use" /> },
          { term: "Expires", value: <Timestamp value={key.expiresAt} label="expiry" /> },
          { term: "Rotated", value: <Timestamp value={key.rotatedAt} label="rotation" /> },
        ]}
      />
    </Section>
  )
}

function PolicySection({ policy }: { policy: KeyDetail["policy"] }) {
  return (
    <Section title="Policy">
      {policy === null ? (
        <NoneCell label="policy" />
      ) : (
        <DescriptionList
          items={[
            { term: "Name", value: policy.name },
            { term: "Max lifetime", value: formatDuration(policy.maxKeyLifetimeSeconds) },
            { term: "Grace period", value: formatDuration(policy.graceSeconds) },
          ]}
        />
      )}
    </Section>
  )
}

function MetadataSection({ metadata }: { metadata: KeyDetail["metadata"] }) {
  const entries = Object.entries(metadata ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )
  return (
    <Section title="Metadata">
      {entries.length === 0 ? (
        <NoneCell label="metadata" />
      ) : (
        <DescriptionList
          items={entries.map(([k, v]) => ({
            term: k,
            value: typeof v === "string" ? v : JSON.stringify(v),
          }))}
        />
      )}
    </Section>
  )
}
