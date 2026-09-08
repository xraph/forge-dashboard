import { SLOT_NAMES } from "./types"
import type { ForgeSubPlugin, PluginNavItem, SlotName, SubPluginInput } from "./types"

const KNOWN_SLOTS = new Set<string>(SLOT_NAMES)

function validateNav(items: PluginNavItem[], extension: string): void {
  for (const item of items) {
    if (!item.to.startsWith("/")) {
      throw new Error(
        `defineSubPlugin: nav item "to" value "${item.to}" must start with "/" (sub-plugin "${extension}")`,
      )
    }
    if (item.children) validateNav(item.children, extension)
  }
}

/**
 * Declares a sub-plugin: UI that mounts inside another plugin's namespace
 * while still belonging to its own Go contributor.
 *
 * The two names are the whole idea. `extension` is what this sub-plugin
 * queries and what decides whether it renders; `host` is only where its pages
 * appear. That split is why the organization plugin's pages can sit under
 * "/@auth/organizations" while still being unable to read a single auth
 * intent it has not declared.
 *
 * Validation throws here, at import time, exactly as `definePlugin` does. A
 * sub-plugin with a bad shape should break the build that includes it rather
 * than quietly never rendering, which is the failure mode a mistyped slot name
 * otherwise has: `PluginSlot` would look for a slot nobody contributes to and
 * correctly render nothing.
 */
export function defineSubPlugin(input: SubPluginInput): ForgeSubPlugin {
  if (!input.extension) {
    throw new Error(
      "defineSubPlugin requires an `extension` naming the Go contributor this sub-plugin belongs to",
    )
  }
  if (!input.host) {
    throw new Error(
      `defineSubPlugin requires a \`host\` naming the plugin this mounts inside (sub-plugin "${input.extension}")`,
    )
  }
  if (input.host === input.extension) {
    throw new Error(
      `defineSubPlugin: sub-plugin "${input.extension}" names itself as its own host. A sub-plugin mounts inside a different plugin; if this is meant to stand alone, use definePlugin instead.`,
    )
  }

  for (const route of input.routes ?? []) {
    if (!route.path.startsWith("/")) {
      throw new Error(
        `defineSubPlugin: route path "${route.path}" must start with "/" (sub-plugin "${input.extension}")`,
      )
    }
  }

  validateNav(input.nav ?? [], input.extension)

  const contributions = input.contributions ?? {}
  for (const [slot, entries] of Object.entries(contributions)) {
    if (!KNOWN_SLOTS.has(slot)) {
      throw new Error(
        `defineSubPlugin: unknown slot "${slot}" (sub-plugin "${input.extension}"). Known slots: ${[...KNOWN_SLOTS].join(", ")}`,
      )
    }
    const seen = new Set<string>()
    for (const entry of entries ?? []) {
      if (seen.has(entry.id)) {
        throw new Error(
          `defineSubPlugin: two contributions to "${slot}" both use the id "${entry.id}", so the slot cannot key them apart (sub-plugin "${input.extension}")`,
        )
      }
      seen.add(entry.id)
    }
  }

  return {
    ...input,
    nav: input.nav ?? [],
    routes: input.routes ?? [],
    contributions: contributions as Partial<Record<SlotName, ForgeSubPlugin["contributions"][SlotName]>>,
    hostIntents: input.hostIntents ?? [],
  }
}
