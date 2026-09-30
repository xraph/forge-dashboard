import { useMemo, type ReactNode } from "react"
import { createColumnHelper, FlexRender, tableFeatures, useTable, type RowData } from "@tanstack/react-table"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@forge-go/dashboard-kit/components/table"
import { cn } from "@forge-go/dashboard-kit/lib/utils"

export interface LedgerColumn<Row> {
  id: string
  header: string
  cell: (row: Row) => ReactNode
  align?: "start" | "end"
  className?: string
}

// No sorting, filtering or paging: these are the nested tables inside a
// detail page (a plan's features, its tiers, an invoice's lines), where the
// order is the contract's and every row is on screen. Registering nothing
// keeps the rest of TanStack Table out of the bundle.
const features = tableFeatures({})

/**
 * The spec's "genuinely tables" (invoice line items, price tiers, plan
 * features), on TanStack Table v9 over the kit's table primitives. Same
 * conventions as ResourceTable: a caption with a live count, the count kept
 * when there are no rows, alignment and classes on both header and cell.
 */
// `Row extends RowData` because v9 constrains its row type to an object or an
// array. Every caller's row is an interface, which satisfies it.
export function LedgerTable<Row extends RowData>({
  columns,
  rows,
  rowKey,
  caption,
  emptyMessage,
  footer,
}: {
  columns: LedgerColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  caption: string
  emptyMessage: string
  footer?: ReactNode
}) {
  const defs = useMemo(() => {
    const helper = createColumnHelper<typeof features, Row>()
    return helper.columns(
      columns.map((c) =>
        helper.display({
          id: c.id,
          header: () => c.header,
          cell: ({ row }) => c.cell(row.original),
        }),
      ),
    )
  }, [columns])
  const table = useTable({ features, data: rows, columns: defs, getRowId: (row) => rowKey(row) })
  const byId = new Map(columns.map((c) => [c.id, c]))
  const classFor = (id: string) => {
    const c = byId.get(id)
    return cn(c?.align === "end" && "text-right", c?.className)
  }

  if (rows.length === 0) return <EmptyState title={emptyMessage} description={caption} />

  return (
    <Table containerProps={{ tabIndex: 0, role: "region", "aria-label": caption }}>
      <TableCaption>{caption}</TableCaption>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => (
              <TableHead key={header.id} className={classFor(header.column.id)}>
                {header.isPlaceholder ? null : <FlexRender header={header} />}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {/* getAllCells, not getVisibleCells: visibility is a feature this table does not register. */}
            {row.getAllCells().map((cell) => (
              <TableCell key={cell.id} className={classFor(cell.column.id)}>
                <FlexRender cell={cell} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
      {footer && <TableFooter>{footer}</TableFooter>}
    </Table>
  )
}
