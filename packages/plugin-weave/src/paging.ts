import type { PaginationState } from "@forge-go/dashboard-kit/components/resource-table"

/** What every list asks for. The server clamps it and echoes what it used. */
export const PAGE_SIZE = 25

/** ResourceTable's one-based pagination, from the limit and offset the server applied. */
export function pageOf(list: { total: number; limit: number; offset: number }): PaginationState {
  const limit = list.limit > 0 ? list.limit : PAGE_SIZE
  return { page: Math.floor(list.offset / limit) + 1, pageSize: limit, total: list.total }
}

export function offsetFor(page: number, limit: number): number {
  return Math.max(0, (page - 1) * limit)
}
