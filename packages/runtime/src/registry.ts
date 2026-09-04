import type { IntentComponent } from "./types"

export type CollisionPolicy = "throw" | "warn"

export interface IntentRegistryOptions {
  /**
   * What to do when two contributor modules claim the same intent.
   * Defaults to "throw" in development and "warn" in production.
   */
  onCollision?: CollisionPolicy
  /** Where warnings go. Defaults to console.warn. Injectable for tests. */
  warn?: (message: string) => void
}

// When the environment cannot be determined - a Next.js server render, for
// instance, where import.meta.env may be absent - default to "warn", because
// staying up is the safer unknown-case behaviour.
function defaultCollisionPolicy(): CollisionPolicy {
  const env =
    typeof import.meta !== "undefined"
      ? (import.meta as { env?: { DEV?: boolean } }).env
      : undefined
  return env?.DEV === true ? "throw" : "warn"
}

/**
 * Maps intent names to the components that render them.
 *
 * Core intents go in through register. Contributor modules go in through
 * registerNamespaced, which refuses any intent outside the contributor's own
 * namespace so an extension cannot replace a core intent for the whole app.
 */
export class IntentRegistry {
  private byName = new Map<string, IntentComponent>()
  private owners = new Map<string, string>()
  private onCollision: CollisionPolicy
  private warn: (message: string) => void

  constructor(options: IntentRegistryOptions = {}) {
    this.onCollision = options.onCollision ?? defaultCollisionPolicy()
    this.warn = options.warn ?? ((message: string) => console.warn(message))
  }

  register(name: string, component: IntentComponent): this {
    this.byName.set(name, component)
    return this
  }

  /**
   * Registers a contributor module's intents. Every key must be prefixed with
   * the contributor name followed by a dot.
   */
  registerNamespaced(
    contributor: string,
    intents: Record<string, IntentComponent>,
  ): this {
    if (!contributor) {
      throw new Error("registerNamespaced requires a contributor name")
    }

    const prefix = `${contributor}.`
    for (const name of Object.keys(intents)) {
      if (!name.startsWith(prefix)) {
        throw new Error(
          `intent "${name}" is outside the "${contributor}" namespace; ` +
            `contributor modules may only register intents prefixed "${prefix}"`,
        )
      }
    }

    for (const [name, component] of Object.entries(intents)) {
      this.registerContributorIntent(contributor, name, component)
    }
    return this
  }

  /**
   * Installs one already-namespace-checked contributor intent.
   *
   * Collision policy: during development a collision must be impossible to
   * miss, so it throws at startup naming both contributors. In production
   * one badly-packaged extension must not take down a dashboard that is
   * mostly unrelated to it, so the first registration wins and the second
   * is logged. Re-registration by the SAME contributor (e.g. a module
   * reloading) is not a collision.
   */
  private registerContributorIntent(
    contributor: string,
    name: string,
    component: IntentComponent,
  ): void {
    const existing = this.owners.get(name)
    if (existing && existing !== contributor) {
      const message =
        `intent "${name}" is claimed by both "${existing}" and "${contributor}"; ` +
        `"${existing}" registered first and is being kept`
      if (this.onCollision === "throw") {
        throw new Error(message)
      }
      this.warn(message)
      return
    }
    this.owners.set(name, contributor)
    this.byName.set(name, component)
  }

  resolve(name: string): IntentComponent | undefined {
    return this.byName.get(name)
  }

  has(name: string): boolean {
    return this.byName.has(name)
  }
}
