/**
 * Turns an untrusted `next` query parameter into a path this app will navigate
 * to, or the basename when it cannot.
 *
 * The parameter is attacker-controlled, so the rule is an allowlist: one
 * leading slash, no second slash, no backslash, no scheme, no control
 * characters. "//evil.example.com" is the case worth naming, because it is a
 * valid protocol-relative URL that leaves the site and it passes a naive
 * startsWith("/") check. Control characters (codepoint < 0x20 and DEL at 0x7f)
 * are rejected because the WHATWG URL parser strips them globally before
 * resolving, so "/\t/evil.example.com" would pass a naive check but the
 * browser would strip the tab and then resolve to evil.example.com.
 *
 * Implemented here rather than taken from an auth vendor's package so the rule
 * holds whichever provider a dashboard is running.
 */
export function safeNext(raw: string | null, basename: string): string {
  if (!raw) return basename
  if (!raw.startsWith("/")) return basename
  if (raw.startsWith("//") || raw.startsWith("/\\")) return basename

  // Reject C0 control characters (< 0x20) and DEL (0x7f) that the URL parser
  // would strip before resolving
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return basename
  }

  return raw
}
