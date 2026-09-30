/**
 * A plugin has one name: its Go extension's. The contributor, the URL
 * segment and the label an operator reads in the sidebar all say it. A second
 * name ("Billing" on the ledger plugin) leaves the operator with no way to
 * tell which extension a page belongs to, or what to look for in the Go
 * config when that page is wrong.
 */

function squash(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, "")
}

/**
 * Whether `label` spells `extension`. Case, spaces, dashes and underscores
 * don't count, so "API key" names apikey and "Audit hook" names audit-hook.
 * A plural doesn't: "Organizations" is a label for a list page, not for the
 * organization extension.
 */
export function labelNamesExtension(label: string, extension: string): boolean {
  return squash(label) === squash(extension)
}

/** The label an extension gets when it declares none: "audit-hook" reads "Audit hook". */
export function defaultLabel(extension: string): string {
  const words = extension.replace(/[_-]+/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
