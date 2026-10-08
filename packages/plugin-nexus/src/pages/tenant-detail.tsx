import { useState } from "react"
import {
  PluginLink,
  useQuery,
  type PluginPageProps,
} from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { PencilIcon } from "@forge-go/dashboard-kit/icons"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { KeyDialog } from "../components/key-dialog"
import { TenantBadge } from "../badges"
import { KeyList } from "../components/key-list"
import { TenantStatusActions } from "../components/tenant-status"
import { Money } from "../components/money"
import {
  count,
  Empty,
  Facts,
  limit,
  Metrics,
  Notice,
  Refresh,
  Section,
  UsageOff,
} from "../components/read"
import { validID } from "../format"
import { compareMoney, sharePercent } from "../money"
import type { Tenant } from "../types"

export function TenantDetailPage({ params }: PluginPageProps) {
  const [creatingKey, setCreatingKey] = useState(false)
  const valid = validID(params.id, "tenant")
  const query = useQuery<Tenant>(
    "tenants.get",
    { id: params.id },
    { enabled: valid }
  )
  if (!valid)
    return (
      <Empty
        title="Invalid tenant address"
        body="Choose a tenant from the customer list."
        action={<PluginLink to="/tenants">View tenants</PluginLink>}
      />
    )
  if (query.error?.code === "NOT_FOUND")
    return (
      <Empty
        title="Tenant not found"
        body="This tenant is no longer available. Choose another tenant."
        action={<PluginLink to="/tenants">View tenants</PluginLink>}
      />
    )
  return (
    <div className="space-y-3">
      <PageHeader
        title={query.data?.name ?? "Tenant"}
        description={params.id}
        actions={
          <div className="flex flex-wrap items-center gap-1">
            <Refresh onClick={query.refetch} />
            {query.data && (
              <>
                <IconButton
                  label="Edit tenant"
                  icon={PencilIcon}
                  nativeButton={false}
                  render={<PluginLink to={`/tenants/${query.data.id}/edit`} />}
                />
                <TenantStatusActions key={query.data.id} tenant={query.data} />
              </>
            )}
          </div>
        }
      />
      <QueryBoundary title="Tenant" query={query}>
        {(data) => (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <TenantBadge status={data.status} />
              <span className="text-muted-foreground">{data.slug}</span>
              <Timestamp
                value={data.createdAt ?? undefined}
                label="creation time"
              />
              <span>
                Updated{" "}
                <Timestamp
                  value={data.updatedAt ?? undefined}
                  label="last update"
                />
              </span>
            </div>
            {!data.usageEnabled && <UsageOff />}
            <Metrics
              items={[
                {
                  label: "Month spend",
                  value: <Money value={data.monthSpendUsd} />,
                },
                {
                  label: "Monthly budget",
                  value:
                    compareMoney(data.quota.monthlyBudgetUsd, "0") === 0 ? (
                      "Unlimited"
                    ) : (
                      <Money value={data.quota.monthlyBudgetUsd} />
                    ),
                },
                {
                  label: "Requests today",
                  value: count(data.requestsToday),
                  hint: "UTC day, refusals excluded",
                },
                {
                  label: "Daily limit",
                  value: limit(data.quota.dailyRequests),
                },
              ]}
            />
            {data.monthSpendUsd !== null &&
              sharePercent(data.monthSpendUsd, data.quota.monthlyBudgetUsd) !==
                null && (
                <div className="space-y-1 text-xs">
                  <p>
                    {compareMoney(
                      data.monthSpendUsd,
                      data.quota.monthlyBudgetUsd
                    ) > 0
                      ? "Monthly budget exceeded"
                      : `${sharePercent(data.monthSpendUsd, data.quota.monthlyBudgetUsd)}% of monthly budget`}
                  </p>
                  <div
                    aria-hidden="true"
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full bg-primary"
                      style={{
                        width: `${sharePercent(data.monthSpendUsd, data.quota.monthlyBudgetUsd)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            <Section title="Request limits">
              {data.requestsToday !== null && data.quota.dailyRequests > 0 && (
                <div className="space-y-1 text-xs">
                  <span>
                    {count(data.requestsToday)} of{" "}
                    {count(data.quota.dailyRequests)} daily requests
                  </span>
                  <div
                    aria-hidden="true"
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full bg-primary"
                      style={{
                        width: `${sharePercent(String(data.requestsToday), String(data.quota.dailyRequests))}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              <Facts
                items={[
                  {
                    label: "Requests per minute",
                    value: limit(data.quota.rpm),
                  },
                  { label: "Tokens per minute", value: limit(data.quota.tpm) },
                  {
                    label: "Tokens per request",
                    value: limit(data.quota.maxTokensPerReq),
                  },
                  {
                    label: "Stream tokens",
                    value: limit(data.quota.maxStreamTokens),
                  },
                  {
                    label: "Stream duration",
                    value:
                      data.quota.maxStreamDurationMs === 0
                        ? "Unlimited"
                        : `${count(data.quota.maxStreamDurationMs)} ms`,
                  },
                ]}
              />
            </Section>
            <Notice>
              RPM and TPM use your configured limiter. Memory limits apply per
              replica.{" "}
              <PluginLink to="/gateway">Inspect gateway enforcement</PluginLink>
            </Notice>
            <Notice>
              Monthly budgets are soft limits. In-flight requests, unpriced
              calls and records that fail to store can exceed the budget.
            </Notice>
            <Section title="Configuration">
              <Facts
                items={[
                  {
                    label: "Default model",
                    value: data.config.defaultModel || "None",
                  },
                  {
                    label: "Allowed models",
                    value: data.config.allowedModels.join(", ") || "All models",
                  },
                  {
                    label: "Blocked models",
                    value: data.config.blockedModels.join(", ") || "None",
                  },
                  {
                    label: "Cache",
                    value:
                      data.config.cacheEnabled === null
                        ? "Inherit gateway setting"
                        : data.config.cacheEnabled
                          ? "Enabled"
                          : "Disabled",
                  },
                  {
                    label: "Routing strategy",
                    value: (
                      <>
                        {data.config.routingStrategy || "Default"}
                        <p className="text-xs text-muted-foreground">
                          {data.config.routingStrategyEnforced
                            ? "Enforced"
                            : "Stored, not enforced"}
                        </p>
                      </>
                    ),
                  },
                  {
                    label: "Guardrail policy",
                    value: (
                      <>
                        {data.config.guardrailPolicy || "None"}
                        <p className="text-xs text-muted-foreground">
                          {data.config.guardrailPolicyEnforced
                            ? "Enforced"
                            : "Stored, not enforced"}
                        </p>
                      </>
                    ),
                  },
                ]}
              />
            </Section>
            <Section title="Tenant metadata">
              {Object.keys(data.metadata ?? {}).length ? (
                <Facts
                  items={Object.entries(data.metadata!).map(
                    ([label, value]) => ({ label, value })
                  )}
                />
              ) : (
                <Empty
                  title="No tenant metadata"
                  body="This tenant has no attached metadata."
                  action={<Refresh onClick={query.refetch} />}
                />
              )}
            </Section>
            <Section title="Configuration metadata">
              {Object.keys(data.config.metadata ?? {}).length ? (
                <Facts
                  items={Object.entries(data.config.metadata!).map(
                    ([label, value]) => ({ label, value })
                  )}
                />
              ) : (
                <Empty
                  title="No configuration metadata"
                  body="No metadata is attached to this configuration."
                  action={<Refresh onClick={query.refetch} />}
                />
              )}
            </Section>
            <Section
              title="API keys"
              action={
                <Button size="sm" onClick={() => setCreatingKey(true)}>
                  Create API key
                </Button>
              }
            >
              <KeyList key={data.id} tenantId={data.id} />
            </Section>
          </>
        )}
      </QueryBoundary>
      <KeyDialog
        key={params.id}
        open={creatingKey}
        onOpenChange={setCreatingKey}
        tenantId={params.id}
      />
    </div>
  )
}
