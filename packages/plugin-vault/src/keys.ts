/**
 * Paths to one secret's pages.
 *
 * A secret key is an operator-chosen string and routinely holds `/` and `.`
 * ("db/primary.password"). Dropped raw into a path, the slash splits the key
 * across two route segments and `/secrets/:key` never matches. Every link to
 * a secret goes through these, so no page builds the path by hand and forgets.
 * The router decodes the param on the way back in, so the key round-trips.
 */
export function secretPath(key: string): string {
  return `/secrets/${encodeURIComponent(key)}`
}

export function rotationPath(key: string): string {
  return `/rotation/${encodeURIComponent(key)}`
}

/**
 * The path to one flag's page. Flag keys are operator-chosen and routinely
 * hold `/` ("checkout/new-flow"), so the key is encoded for the same reason
 * secretPath encodes its own.
 */
export function flagPath(key: string): string {
  return `/flags/${encodeURIComponent(key)}`
}
