export const collections = [
  "instincts",
  "awareness",
  "boundaries",
  "values",
  "judgments",
  "reflexes",
  "profiles",
  "policies",
] as const
export type Collection = (typeof collections)[number] | "scans" | "compliance"
export type Row = {
  id: string
  name?: string
  enabled?: boolean
  created_at?: string
  updated_at?: string
  [key: string]: unknown
}
export interface Page {
  items: Row[]
  total: number
  limit: number
  offset: number
  has_more: boolean
  refreshed_at?: string
}
export interface PrivacyPageData extends Page {
  by_type: Record<string, number>
  distinct_types: number
}
export interface Field {
  key: string
  label: string
  type: string
  options?: string[]
  fields?: Field[]
  max_length?: number
  max_items?: number
  json_bytes_max?: number
  minimum?: number
  maximum?: number
  required?: boolean
}
export interface Capabilities {
  engine: {
    evaluation: boolean
    persistence?: boolean
    unavailable_layers: string[]
  }
  scope: {
    app_id: string
    tenant_id: string
    policy_key?: string
    policy_level?: string
  }
  can_manage: boolean
  can_manage_privacy: boolean
  schemas: Record<string, Field[]>
}
export interface Overview {
  sections: {
    collection: string
    total?: number
    available: boolean
    error?: string
  }[]
  refreshed_at?: string
}
export interface Preview {
  id: string
  cutoff: string
  expires_at: string
  token_ids: string[]
  total: number
  has_more: boolean
}
export const label = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (s) => s.toUpperCase())
export const path = (collection: string, id?: string) =>
  `/${collection}${id ? `/${encodeURIComponent(id)}` : ""}`

export const singular = (value: string) =>
  ({
    awareness: "awareness",
    reflexes: "reflex",
    policies: "policy",
    boundaries: "boundary",
    strategies: "strategy",
  })[value] ?? value.replace(/s$/, "")
