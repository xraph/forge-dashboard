import { moneyParts } from "../money"

export function Money({
  value,
  unavailable = "Unavailable",
}: {
  value: string | null
  unavailable?: string
}) {
  if (value === null)
    return <span className="text-muted-foreground">{unavailable}</span>
  const { main, tail, exact } = moneyParts(value)
  return (
    <span className="font-mono whitespace-nowrap tabular-nums" title={exact}>
      <span className="sr-only">{exact}</span>
      <span aria-hidden="true">
        {main}
        <span className="text-xs text-muted-foreground">{tail}</span>
      </span>
    </span>
  )
}
