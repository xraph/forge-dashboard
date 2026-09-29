function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * "86400" becomes "1 day". Only exact units are folded, so nothing is rounded:
 * 5400 is "90 minutes", and 90 is "90 seconds".
 */
export function formatInterval(seconds: number): string {
  if (seconds > 0 && seconds % 86400 === 0) return plural(seconds / 86400, "day", "days")
  if (seconds > 0 && seconds % 3600 === 0) return plural(seconds / 3600, "hour", "hours")
  if (seconds > 0 && seconds % 60 === 0) return plural(seconds / 60, "minute", "minutes")
  return plural(seconds, "second", "seconds")
}
