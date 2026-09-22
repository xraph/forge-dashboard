/**
 * The origin a visitor's browser is actually signing in to.
 *
 * This is NOT the Forge server's real hostname. That hostname is a
 * server-side-only proxy target the browser never learns, so there is no
 * truthful way to show it here. What this function reads instead is the
 * origin the visitor is looking at right now, which is the one thing that
 * actually distinguishes two deployments from the visitor's point of view:
 * run more than one Forge behind the same UI and this is the only honest
 * label telling them apart.
 *
 * Guarded for `typeof window === "undefined"` because AuthLayout renders in
 * jsdom (no browser `window.location` to read) and under Next.js dynamic
 * import with `ssr: false` (a brief window where the module has loaded but
 * the client has not mounted). Both cases get no server host rather than a
 * throw or a guessed value.
 */
export function currentServerHost(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.host
}
