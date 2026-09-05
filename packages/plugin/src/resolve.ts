import type { ForgePlugin } from "./types"

/** One contributor's status, as reported by the Go host's capabilities response. */
export interface ContributorCapability {
  name: string
  envelopes: string[]
  /** Permissive on purpose: this task does not need to model intents in detail. */
  intents?: unknown
  /** Omitted by Go (`omitempty`) when the contributor has not reported a version. */
  version?: string
  /**
   * Always present on the wire, never omitted. The frontend has to tell
   * "not configured" apart from "did not say", and that distinction is the
   * entire reason this field exists.
   */
  configured: boolean
  message?: string
}

/** The capabilities payload the host fetches once and resolves every plugin against. */
export interface Capabilities {
  shellEnvelopes: string[]
  contributors: ContributorCapability[]
}

export type PluginState =
  | { kind: "hidden" }
  | { kind: "mismatch"; required: string; reported: string }
  | { kind: "setup"; message?: string }
  | { kind: "ready" }

/**
 * Tiny semver range check: caret ranges ("^X.Y.Z") and exact versions only.
 * No dependency, no pretend generality. Any other form (comparator ranges,
 * "x" ranges, "~", "||", tags like "latest") is unsupported and returns
 * `undefined`, meaning "cannot check" - the caller must treat that as "does
 * not mismatch", never as a failure, because refusing to render because we
 * could not read our own version range is worse than rendering.
 */
function satisfiesRange(range: string, version: string): boolean | undefined {
  const parse = (v: string): [number, number, number] | undefined => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
    if (!m) return undefined
    return [Number(m[1]), Number(m[2]), Number(m[3])]
  }

  const trimmed = range.trim()

  if (trimmed.startsWith("^")) {
    const min = parse(trimmed.slice(1))
    const cur = parse(version)
    if (!min || !cur) return undefined

    const [minMajor, minMinor, minPatch] = min
    const [major, minor, patch] = cur

    if (major !== minMajor) return false

    if (major > 0) {
      // ^1.2.3 allows >=1.2.3 <2.0.0
      if (minor < minMinor) return false
      if (minor === minMinor && patch < minPatch) return false
      return true
    }

    // ^0.x.y is narrower: minor must match too, and only patch may float.
    if (minor !== minMinor) return false
    return patch >= minPatch
  }

  // Exact match: no operator at all.
  const want = parse(trimmed)
  const cur = parse(version)
  if (!want || !cur) return undefined
  return want[0] === cur[0] && want[1] === cur[1] && want[2] === cur[2]
}

/**
 * Decides, for one plugin, which of the four things the host renders.
 *
 * Order matters: version is checked before configured. A contributor that is
 * both out of range and unconfigured shows mismatch, not setup, because an
 * out-of-range extension cannot be trusted to render its own setup screen
 * correctly either.
 */
export function resolvePluginState(plugin: ForgePlugin, capabilities: Capabilities): PluginState {
  const contributor = capabilities.contributors.find((c) => c.name === plugin.extension)
  if (!contributor) return { kind: "hidden" }

  // Three separate reasons all mean "skip the version check": the plugin
  // declares no requires, the contributor reported no version (Go omits it
  // when empty), or the requires range is a form this checker cannot read.
  if (plugin.requires && contributor.version) {
    const satisfies = satisfiesRange(plugin.requires, contributor.version)
    if (satisfies === false) {
      return { kind: "mismatch", required: plugin.requires, reported: contributor.version }
    }
  }

  if (!contributor.configured) {
    return { kind: "setup", message: contributor.message }
  }

  return { kind: "ready" }
}
