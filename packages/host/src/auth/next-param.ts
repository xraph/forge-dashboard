/**
 * Turns an untrusted `next` query parameter into a path this app will navigate
 * to, or the basename when it cannot.
 *
 * The parameter is attacker-controlled, so the rule is an allowlist: one
 * leading slash, no second slash, no backslash, no scheme. "//evil.example.com"
 * is the case worth naming, because it is a valid protocol-relative URL that
 * leaves the site and it passes a naive startsWith("/") check.
 *
 * Implemented here rather than taken from an auth vendor's package so the rule
 * holds whichever provider a dashboard is running.
 */
export function safeNext(raw: string | null, basename: string): string {
  if (!raw) return basename
  if (!raw.startsWith("/")) return basename
  if (raw.startsWith("//") || raw.startsWith("/\\")) return basename
  return raw
}
