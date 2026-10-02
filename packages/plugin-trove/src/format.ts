const grouped = new Intl.NumberFormat("en-US")
const UNITS = ["KiB", "MiB", "GiB", "TiB"]

/** The exact size: "4,812 B". This is the identifier-shaped value. */
export function formatBytes(n: number): string {
  return `${grouped.format(n)} B`
}

/** A readable size for a title or hint: "4.7 KiB". */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  let value = n / 1024
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${UNITS[unit]}`
}
