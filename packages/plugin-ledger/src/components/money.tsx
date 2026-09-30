import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { formatMoney } from "../lib/money"
import type { Money } from "../types"

/** An amount, in tabular figures so a column of them lines up on the decimal. */
export function MoneyText({ value, className }: { value: Money; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{formatMoney(value)}</span>
}
