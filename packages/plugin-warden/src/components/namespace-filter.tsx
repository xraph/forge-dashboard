import { useState } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { FilterConfig, FilterOption } from "@forge-go/dashboard-kit/components/filter-bar"

/**
 * Namespace has three states, not two.
 *
 * The contract's namespace field is a `*string`: nil means every namespace,
 * the empty string means the tenant root, and a path means that one. Those
 * are genuinely different queries, and the store treats them differently, so
 * the UI cannot collapse "all" and "root" into one blank option.
 *
 * "all" is a sentinel here rather than a real namespace path, chosen because
 * namespaceSegmentRegex requires a segment to start with a letter and the
 * sentinel never reaches the wire: namespaceParam turns it into an absent
 * field.
 */
export type NamespaceValue = "all" | string

export interface NamespacesResponse {
  namespaces: string[]
}

/**
 * The tenant root renders as "/" rather than the word "root", because
 * namespaceSegmentRegex permits "root" as an ordinary segment name and a
 * namespace actually called root would otherwise be indistinguishable from
 * it. ValidateNamespacePath forbids a leading or trailing slash, so "/" is a
 * token no real path can produce.
 *
 * The root is not an absent value and does not use NoneCell. It is a real
 * place where things live.
 */
export function NamespaceCell({ path }: { path: string }) {
  return (
    <span className="font-mono text-xs" title={path === "" ? "Tenant root" : path}>
      {path === "" ? "/" : path}
    </span>
  )
}

/** Turns the selected value into the query params the contract expects. */
export function namespaceParam(value: NamespaceValue): { namespacePath?: string } {
  return value === "all" ? {} : { namespacePath: value }
}

/** Builds the select's options. Every option carries a real label. */
export function namespaceOptions(namespaces: string[]): FilterOption[] {
  const opts: FilterOption[] = [{ label: "All namespaces", value: "all" }]
  for (const ns of namespaces) {
    opts.push(ns === "" ? { label: "Tenant root", value: "" } : { label: ns, value: ns })
  }
  return opts
}

/**
 * The hook every list page uses. It holds the selection, fetches the
 * namespace list once, and hands back both the FilterBar config and the
 * query params.
 *
 * The list query failing is not fatal: the filter falls back to offering
 * "All namespaces" and "Tenant root", which are the two that always exist,
 * so a page whose namespace list is unavailable still renders its rows.
 */
export function useNamespaceFilter() {
  const [value, setValue] = useState<NamespaceValue>("all")
  const list = useQuery<NamespacesResponse>("namespaces.list")

  const namespaces = list.data?.namespaces ?? [""]
  const filterConfig: FilterConfig = {
    id: "namespace",
    label: "Namespace",
    value,
    options: namespaceOptions(namespaces),
    onChange: (next) => setValue(next as NamespaceValue),
  }

  return { value, setValue, filterConfig, param: namespaceParam(value) }
}
