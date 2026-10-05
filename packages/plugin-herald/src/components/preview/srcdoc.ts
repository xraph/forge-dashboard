/*
 * The document an email preview renders in. It goes into
 * <iframe sandbox="" srcdoc>: the empty sandbox denies scripts, forms, popups
 * and same-origin access, so rendered markup can't touch the dashboard. The
 * CSP comes first in <head> and allows inline styles and data: images only,
 * which keeps a tracking pixel in a template from firing from the operator's
 * browser. Remote images load only when the operator asks.
 */
export function buildSrcdoc(html: string, allowRemoteImages: boolean): string {
  const images = allowRemoteImages ? "img-src data: https: http:;" : "img-src data:;"
  const csp = `default-src 'none'; style-src 'unsafe-inline'; ${images} font-src data:`
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta charset="utf-8"></head><body>${html}</body></html>`
}
