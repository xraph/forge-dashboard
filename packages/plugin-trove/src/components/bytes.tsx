import { formatBytes, humanBytes } from "../format"

/** A byte count as the exact number, with the readable size on hover. */
export function Bytes({ value }: { value: number }) {
  return (
    <span className="font-mono text-xs tabular-nums" title={humanBytes(value)}>
      {formatBytes(value)}
    </span>
  )
}
