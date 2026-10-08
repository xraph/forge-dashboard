export type Row = Record<string, unknown>
export interface Listing {
  items: Row[]
  total?: number
  next_cursor?: string
  complete?: boolean
}
export type PageProps = { params?: Record<string, string | undefined> }
export interface Field {
  key: string
  label: string
  type?:
    | "number"
    | "password"
    | "checkbox"
    | "json"
    | "services"
    | "select"
    | "group"
  required?: boolean
  children?: Field[]
  options?: string[]
  hint?: string
  value?: unknown
}
export interface Action {
  intent: string
  label: string
  fields?: Field[]
  destructive?: boolean
  description?: string
  nested?: boolean
  redirect?: string
}
export interface Resource {
  key: string
  title: string
  singular: string
  columns: string[]
  fields: string[]
  filters?: string[]
  actions?: Action[]
  create?: Field[]
  edit?: Field[]
}
export function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {}
}
export function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value)
}
export function label(key: string): string {
  return key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())
}
export function rows(value: unknown): Row[] {
  const items = Array.isArray(value) ? value : record(value).items
  return Array.isArray(items) ? items.map(record) : []
}
export function identity(row: Row): string {
  return text(row.id ?? row.name ?? row.key)
}
export function mainImage(row: Row): string {
  const services = rows(row.services)
  return (
    text(row.image) ||
    text(
      (services.find((s) => s.role === "main" || !s.role) ?? services[0])?.image
    )
  )
}
