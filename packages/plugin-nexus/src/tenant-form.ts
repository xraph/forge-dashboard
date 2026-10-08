import { compareMoney, validBudget } from "./money"
import type {
  Quota,
  Tenant,
  TenantConfigWrite,
  TenantCreate,
  TenantUpdate,
} from "./types"

export const quotaLabels: Record<keyof Quota, string> = {
  rpm: "Requests per minute",
  tpm: "Tokens per minute",
  dailyRequests: "Daily requests",
  monthlyBudgetUsd: "Monthly budget (USD)",
  maxTokensPerReq: "Tokens per request",
  maxStreamDurationMs: "Stream duration (ms)",
  maxStreamTokens: "Stream tokens",
}
export type MetadataDraft = { key: string; value: string }[]
export interface TenantDraft {
  name: string
  slug: string
  quota: Record<keyof Quota, { unlimited: boolean; value: string }>
  config: {
    allowedModels: string
    blockedModels: string
    defaultModel: string
    routingStrategy: string
    guardrailPolicy: string
    cacheEnabled: "inherit" | "enabled" | "disabled"
    metadata: MetadataDraft
  }
  metadata: MetadataDraft
}
const metadataDraft = (value: Record<string, string> | null | undefined) =>
  Object.entries(value ?? {}).map(([key, value]) => ({ key, value }))
export function tenantDraft(tenant?: Tenant): TenantDraft {
  return {
    name: tenant?.name ?? "",
    slug: tenant?.slug ?? "",
    quota: Object.fromEntries(
      Object.keys(quotaLabels).map((key) => {
        const value = String(tenant?.quota[key as keyof Quota] ?? "0")
        return [key, { unlimited: compareMoney(value, "0") === 0, value }]
      })
    ) as TenantDraft["quota"],
    config: {
      allowedModels: tenant?.config.allowedModels.join(", ") ?? "",
      blockedModels: tenant?.config.blockedModels.join(", ") ?? "",
      defaultModel: tenant?.config.defaultModel ?? "",
      routingStrategy: tenant?.config.routingStrategy ?? "",
      guardrailPolicy: tenant?.config.guardrailPolicy ?? "",
      cacheEnabled:
        tenant?.config.cacheEnabled == null
          ? "inherit"
          : tenant.config.cacheEnabled
            ? "enabled"
            : "disabled",
      metadata: metadataDraft(tenant?.config.metadata),
    },
    metadata: metadataDraft(tenant?.metadata),
  }
}
function metadata(rows: MetadataDraft, label: string): Record<string, string> {
  const seen = new Set<string>()
  return Object.fromEntries(
    rows.map((row) => {
      const key = row.key.trim()
      if (!key) throw new Error(`${label}: every entry needs a key.`)
      if (seen.has(key)) throw new Error(`${label}: duplicate key ${key}.`)
      if (typeof row.value !== "string")
        throw new Error(`${label}: values must be text.`)
      seen.add(key)
      return [key, row.value]
    })
  )
}
const models = (value: string) => [
  ...new Set(
    value
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
  ),
]
function same(left: unknown, right: unknown): boolean {
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const sorted = (value: object) =>
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right))
  }
  return JSON.stringify(left) === JSON.stringify(right)
}
export function tenantPayload(
  draft: TenantDraft,
  original?: Tenant
): TenantCreate | TenantUpdate {
  const initial = original ? tenantDraft(original) : undefined
  const nameChanged = !initial || draft.name !== initial.name
  const name = draft.name.trim(),
    slug = draft.slug.trim()
  if (nameChanged && !name) throw new Error("Name is required.")
  if (!original && !slug) throw new Error("Slug is required.")
  const quota: Partial<Quota> = {}
  for (const key of Object.keys(quotaLabels) as (keyof Quota)[]) {
    if (initial && same(draft.quota[key], initial.quota[key])) continue
    const entry = draft.quota[key],
      value = entry.value.trim()
    if (key === "monthlyBudgetUsd") {
      if (
        !entry.unlimited &&
        (!validBudget(value) || compareMoney(value, "0") <= 0)
      )
        throw new Error(
          `${quotaLabels[key]} must be a positive decimal, or choose No limit.`
        )
      const amount = entry.unlimited ? "0" : value
      if (!original || amount !== original.quota[key]) quota[key] = amount
    } else {
      const limit = entry.unlimited ? 0 : parseInt(value, 10)
      if (
        !entry.unlimited &&
        (!/^\d+$/.test(value) ||
          !Number.isSafeInteger(limit) ||
          limit <= 0 ||
          (key === "maxStreamDurationMs" && limit > 9_223_372_036_854))
      )
        throw new Error(
          `${quotaLabels[key]} must be a supported positive whole number, or choose No limit.`
        )
      if (!original || limit !== original.quota[key]) quota[key] = limit
    }
  }
  const configPatch: Partial<TenantConfigWrite> = {}
  const conversions = {
    allowedModels: () => models(draft.config.allowedModels),
    blockedModels: () => models(draft.config.blockedModels),
    defaultModel: () => draft.config.defaultModel.trim(),
    routingStrategy: () => draft.config.routingStrategy,
    guardrailPolicy: () => draft.config.guardrailPolicy,
    cacheEnabled: () =>
      draft.config.cacheEnabled === "inherit"
        ? null
        : draft.config.cacheEnabled === "enabled",
    metadata: () => metadata(draft.config.metadata, "Configuration metadata"),
  }
  for (const key of Object.keys(conversions) as (keyof typeof conversions)[]) {
    if (initial && same(draft.config[key], initial.config[key])) continue
    Object.assign(configPatch, { [key]: conversions[key]() })
  }
  const metadataChanged = !initial || !same(draft.metadata, initial.metadata)
  return {
    ...(original
      ? { id: original.id, ...(nameChanged ? { name } : {}) }
      : { name, slug }),
    ...(Object.keys(quota).length ? { quota } : {}),
    ...(Object.keys(configPatch).length ? { config: configPatch } : {}),
    ...(metadataChanged
      ? { metadata: metadata(draft.metadata, "Tenant metadata") }
      : {}),
  }
}
