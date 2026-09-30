import { Button } from "@forge-go/dashboard-kit/components/button"

/**
 * Previous and Next for the contract's offset lists.
 *
 * The kit's ResourceTable pager needs a total, and the ledger contract sends
 * has_more instead, so it cannot say "page 2 of 4". This says "Page 2" and
 * nothing it does not know. Renders nothing on a single page, so a short list
 * carries no dead buttons.
 */
export function OffsetPager({
  page,
  hasMore,
  onPageChange,
}: {
  page: number
  hasMore: boolean
  onPageChange: (page: number) => void
}) {
  if (page === 1 && !hasMore) return null
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>Page {page}</span>
      <span className="flex gap-2">
        <Button variant="outline" size="sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" aria-label="Next page" disabled={!hasMore} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </span>
    </nav>
  )
}

/** The way out of a page past the end of a list: one button, worded the same on every list. */
export function BackToFirstPage({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" onClick={onClick}>
      Back to the first page
    </Button>
  )
}
