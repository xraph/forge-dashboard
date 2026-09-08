import type { ReactNode } from "react"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@forge-go/dashboard-kit/components/table"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"

export interface Column<Row> {
  id: string
  header: string
  cell: (row: Row) => ReactNode
  /** Renders the header as a button that reports sort intent. */
  sortable?: boolean
  align?: "start" | "end"
  className?: string
}

export interface SortState {
  columnId: string
  direction: "asc" | "desc"
}

export interface PaginationState {
  /** One-based, matching what an operator reads. */
  page: number
  pageSize: number
  total: number
}

export interface ResourceTableProps<Row> {
  columns: Column<Row>[]
  rows: Row[]
  /** Stable identity per row. Never an array index: rows reorder. */
  rowKey: (row: Row) => string
  caption?: string
  emptyMessage: string
  emptyAction?: ReactNode
  rowActions?: (row: Row) => ReactNode
  sort?: SortState
  onSortChange?: (sort: SortState) => void
  pagination?: PaginationState
  onPageChange?: (page: number) => void
  className?: string
}

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const

/**
 * A list of records with sorting, row actions and pagination.
 *
 * It sorts nothing and pages nothing. Both are controlled, because the server
 * owns ordering and paging: a table that re-sorted the array it was handed
 * would sort one page of a ten-page result and look entirely correct doing it,
 * which is the worst way for this to be wrong.
 *
 * Loading and error are not here either. `QueryBoundary` owns those, and every
 * page already wraps its read in one. Empty is here because emptiness is a
 * property of the rows, and the rows are what this block is handed.
 */
export function ResourceTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  emptyMessage,
  emptyAction,
  rowActions,
  sort,
  onSortChange,
  pagination,
  onPageChange,
  className,
}: ResourceTableProps<Row>) {
  if (rows.length === 0) {
    return <EmptyState title={emptyMessage} description={caption} action={emptyAction} />
  }

  // Clicking the column already sorted flips it. Clicking any other column
  // starts that one ascending, which is what somebody scanning a list expects
  // rather than inheriting the previous column's direction.
  function requestSort(columnId: string) {
    if (!onSortChange) return
    const direction =
      sort?.columnId === columnId && sort.direction === "asc" ? "desc" : "asc"
    onSortChange({ columnId, direction })
  }

  const pageCount = pagination
    ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize))
    : 1

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/*
        Horizontal scroll lives on the vendored Table's own container, not on
        the page. A wide table must not make the whole dashboard scroll
        sideways.
      */}
      <Table
        containerProps={{
          tabIndex: 0,
          role: "region",
          "aria-label": caption ?? "Table",
        }}
      >
        {caption && <TableCaption>{caption}</TableCaption>}
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.id}
                aria-sort={
                  sort?.columnId === column.id
                    ? ARIA_SORT[sort.direction]
                    : undefined
                }
                className={cn(
                  column.align === "end" && "text-right",
                  column.className,
                )}
              >
                {column.sortable && onSortChange ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => requestSort(column.id)}
                  >
                    {column.header}
                    {sort?.columnId === column.id
                      ? sort.direction === "asc"
                        ? " ↑"
                        : " ↓"
                      : ""}
                  </Button>
                ) : (
                  column.header
                )}
              </TableHead>
            ))}
            {rowActions && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={rowKey(row)}>
              {columns.map((column) => (
                <TableCell
                  key={column.id}
                  className={cn(
                    column.align === "end" && "text-right",
                    column.className,
                  )}
                >
                  {column.cell(row)}
                </TableCell>
              ))}
              {rowActions && (
                <TableCell className="flex justify-end gap-2">
                  {rowActions(row)}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/*
        No controls for a single page. A disabled Previous next to a disabled
        Next on a three-row table is furniture.
      */}
      {pagination && onPageChange && pageCount > 1 && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between gap-2 text-sm text-muted-foreground"
        >
          <span>
            Page {pagination.page} of {pageCount}, {pagination.total} total
          </span>
          <span className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-label="Previous page"
              disabled={pagination.page <= 1}
              onClick={() => onPageChange(pagination.page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Next page"
              disabled={pagination.page >= pageCount}
              onClick={() => onPageChange(pagination.page + 1)}
            >
              Next
            </Button>
          </span>
        </nav>
      )}
    </div>
  )
}
