import { expect, it } from "vitest"
import { tenantDraft, tenantPayload } from "../src/tenant-form"
import type { Tenant } from "../src/types"
import { answer } from "./fixtures"

const existing = () =>
  answer<Tenant>("tenants.get", { id: "tenant_00000000000000000000000001" })

it("sends only the edited quota while preserving streaming and config fields", () => {
  const tenant = existing(),
    draft = tenantDraft(tenant)
  draft.quota.rpm = { unlimited: false, value: "240" }
  expect(tenantPayload(draft, tenant)).toEqual({
    id: tenant.id,
    quota: { rpm: 240 },
  })
  const result = answer<Tenant>("tenants.update", {
    ...tenantPayload(draft, tenant),
  })
  expect(result.quota.maxStreamTokens).toBe(tenant.quota.maxStreamTokens)
  expect(result.config).toEqual(tenant.config)
})
it("keeps long budget decimals exact in create and update payloads", () => {
  const draft = tenantDraft()
  draft.name = "Exact"
  draft.slug = "exact"
  draft.quota.monthlyBudgetUsd = {
    unlimited: false,
    value: "9007199254740993.000000150",
  }
  expect(tenantPayload(draft).quota?.monthlyBudgetUsd).toBe(
    "9007199254740993.000000150"
  )
})
it("distinguishes explicit no limit, false, inheritance and empty collections", () => {
  const tenant = existing(),
    draft = tenantDraft(tenant)
  draft.quota.rpm.unlimited = true
  draft.config.cacheEnabled = "disabled"
  draft.config.allowedModels = ""
  draft.metadata = []
  expect(tenantPayload(draft, tenant)).toMatchObject({
    quota: { rpm: 0 },
    config: { cacheEnabled: false },
    metadata: {},
  })
  tenant.config.cacheEnabled = false
  const inherited = tenantDraft(tenant)
  inherited.config.cacheEnabled = "inherit"
  expect(tenantPayload(inherited, tenant)).toEqual({
    id: tenant.id,
    config: { cacheEnabled: null },
  })
})
it("omits unchanged fields and never submits an immutable slug on edit", () => {
  const tenant = existing(),
    draft = tenantDraft(tenant)
  draft.slug = "ignored"
  expect(tenantPayload(draft, tenant)).toEqual({ id: tenant.id })
})
it("leaves untouched stored strings, model IDs and metadata byte-for-byte alone", () => {
  const tenant = existing()
  tenant.name = " Customer "
  tenant.config.allowedModels = [
    "model,with-comma",
    " duplicate ",
    " duplicate ",
  ]
  tenant.config.blockedModels = ["model\nwith-newline"]
  tenant.config.defaultModel = " model "
  tenant.config.metadata = { " region ": "west", region: "east", "": "legacy" }
  tenant.metadata = { " owner ": "team", owner: "other", " ": "legacy" }
  tenant.quota.maxStreamDurationMs = 9_223_372_036_855
  const draft = tenantDraft(tenant)
  expect(tenantPayload(draft, tenant)).toEqual({ id: tenant.id })
  draft.quota.rpm = { unlimited: false, value: "240" }
  expect(tenantPayload(draft, tenant)).toEqual({
    id: tenant.id,
    quota: { rpm: 240 },
  })
})
it("validates integer limits, duration bounds, budget syntax and metadata keys", () => {
  const tenant = existing()
  for (const value of ["-1", "1.5", "1e3", "9007199254740992", ""]) {
    const draft = tenantDraft(tenant)
    draft.quota.rpm = { unlimited: false, value }
    expect(() => tenantPayload(draft, tenant)).toThrow(/Requests per minute/)
  }
  const long = tenantDraft(tenant)
  long.quota.maxStreamDurationMs = { unlimited: false, value: "9223372036855" }
  expect(() => tenantPayload(long, tenant)).toThrow(/Stream duration/)
  const decimal = tenantDraft(tenant)
  decimal.quota.monthlyBudgetUsd = { unlimited: false, value: "1e3" }
  expect(() => tenantPayload(decimal, tenant)).toThrow(/Monthly budget/)
  const metadata = tenantDraft(tenant)
  metadata.metadata = [
    { key: "owner", value: "one" },
    { key: "owner", value: "two" },
  ]
  expect(() => tenantPayload(metadata, tenant)).toThrow(/duplicate/)
})
it("replaces each metadata map deliberately and trims model lists", () => {
  const tenant = existing(),
    draft = tenantDraft(tenant)
  draft.metadata = [{ key: "owner", value: "team" }]
  draft.config.metadata = [{ key: "region", value: "west" }]
  draft.config.blockedModels = " old-model, preview\nlegacy "
  expect(tenantPayload(draft, tenant)).toEqual({
    id: tenant.id,
    metadata: { owner: "team" },
    config: {
      metadata: { region: "west" },
      blockedModels: ["old-model", "preview", "legacy"],
    },
  })
})
