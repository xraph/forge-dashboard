/*
 * The document an email preview renders in. It goes into
 * <iframe sandbox="" srcdoc>: the empty sandbox denies scripts, forms, popups
 * and same-origin access, so rendered markup can't touch the dashboard. The
 * CSP comes first in <head> and allows inline styles and data: images only,
 * which keeps a tracking pixel in a template from firing from the operator's
 * browser. Remote images load only when the operator asks.
 *
 * The template is parsed first (DOMParser documents are inert: no scripts run,
 * nothing loads) so <link> elements can be dropped: preconnect and dns-prefetch
 * are not covered by any CSP directive and would tell a template-chosen host
 * the operator's IP. Head content (style blocks) moves into the body, after the
 * CSP, so nothing the template writes can come before the policy.
 */
export function buildSrcdoc(html: string, allowRemoteImages: boolean): string {
  const images = allowRemoteImages
    ? "img-src data: https: http:;"
    : "img-src data:;"
  const csp = `default-src 'none'; style-src 'unsafe-inline'; ${images} font-src data:`
  const parsed = new DOMParser().parseFromString(html, "text/html")
  parsed.querySelectorAll("link").forEach((link) => link.remove())
  const content = parsed.head.innerHTML + parsed.body.innerHTML
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta charset="utf-8"></head><body>${content}</body></html>`
}
