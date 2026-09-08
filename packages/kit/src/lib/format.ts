/**
 * A timestamp the contract sends as RFC 3339.
 *
 * Two failure modes, both deliberate. An unparseable value prints as it
 * arrived rather than as "Invalid Date", because the string the server sent is
 * the only useful thing to see when this goes wrong. An empty string prints as
 * an en dash rather than as the epoch: authsome sends "" for "never happened",
 * such as `banExpiresAt` on a user who is not banned, and 1 January 1970 is a
 * wrong answer dressed as a right one.
 *
 * Streaming's types marshal from Go `time.Time` and are never empty; authsome's
 * are strings and often are. One formatter handles both.
 */
export function formatTimestamp(value: string | undefined): string {
  if (!value) return "–"
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}
