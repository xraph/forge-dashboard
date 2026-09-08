/**
 * The icon set plugins draw from.
 *
 * A plugin declares `icon` on itself and on its nav items, and both are typed
 * `ReactNode`, so nothing here is mandatory: an author with their own icon
 * system passes their own element and never imports this. What this exists for
 * is the ordinary case. The plugin packages carry no dependencies of their own
 * and peer-depend on this kit, so without this subpath every plugin author has
 * to add `lucide-react` and pin a version that agrees with the one the kit
 * already resolved. Two copies of an icon library in one bundle is the failure
 * mode, and it is silent.
 *
 * Re-exported wholesale rather than curated. A hand-picked list is a list
 * somebody's icon is missing from, and the curation buys nothing: this is an
 * ESM star re-export of an ESM package, so a bundler drops every icon no
 * plugin named. Vite, Next and Rollup all tree-shake it.
 */
export * from "lucide-react"
