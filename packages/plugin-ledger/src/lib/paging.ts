/** The page size every ledger list asks for: the contract's own default. */
export const PAGE_SIZE = 50

/** A one-based page as the contract's {limit, offset}. */
export function pageParams(page: number): { limit: number; offset: number } {
  return { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }
}

/**
 * The live row count for a list caption. The contract answers has_more and
 * never a total, so an exact count is stated only when the first page holds
 * everything; past that the caption names the range on screen and says
 * whether more follows. It never invents a total.
 */
export function pageCaption({
  page,
  shown,
  hasMore,
  singular,
  plural,
}: {
  page: number
  shown: number
  hasMore: boolean
  singular: string
  plural: string
}): string {
  if (page === 1 && !hasMore) return `${shown} ${shown === 1 ? singular : plural}`
  if (shown === 0) return `No ${plural} on page ${page}`
  const first = (page - 1) * PAGE_SIZE + 1
  const last = first + shown - 1
  const label = plural.charAt(0).toUpperCase() + plural.slice(1)
  return `${label} ${first}–${last}${hasMore ? ", more on the next page" : ""}`
}
