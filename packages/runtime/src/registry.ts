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

/**
 * The owner recorded for core intents, the ones installed through register.
 *
 * The leading space is deliberate: registerNamespaced builds its prefix as
 * `${contributor}.`, and a contributor whose name began with a space would
 * have to register intents beginning with a space too. Nothing on the wire
 * looks like that, so no contributor string can ever be mistaken for this one.
 */
const CORE_OWNER = " core"

/**
 * Decides the collision policy from a build environment object.
 *
 * Split out from defaultCollisionPolicy so it can be tested directly. The
 * whole point of this function is that it behaves differently in test than in
 * production, which is exactly the shape of code that goes wrong unnoticed.
 *
 * When the environment cannot be determined - a Next.js server render, for
 * instance, where import.meta.env may be absent - it returns "warn", because
 * staying up is the safer unknown-case behaviour.
 */
export function resolveCollisionPolicy(
  env: { DEV?: boolean } | undefined
): CollisionPolicy {
  return env?.DEV === true ? "throw" : "warn"
}

function defaultCollisionPolicy(): CollisionPolicy {
  const env =
    typeof import.meta !== "undefined"
      ? (import.meta as { env?: { DEV?: boolean } }).env
      : undefined
  return resolveCollisionPolicy(env)
}

/**
 * Maps intent names to the components that render them.
 *
 * Core intents go in through register and are owned by CORE_OWNER. Contributor
 * modules go in through registerNamespaced, which refuses any intent outside
 * the contributor's own namespace, and refuses a core intent outright, so an
 * extension cannot replace a core intent for the whole app - not even one
 * named after a core namespace, such as a contributor called "page" reaching
 * for "page.shell".
 *
 * The registry is mutable and long-lived: modules register into it after the
 * React tree has already mounted. React cannot see that on its own, because
 * the object identity never changes, so the registry publishes a version
 * counter and a subscribe method for useSyncExternalStore to watch.
 */
export class IntentRegistry {
  private byName = new Map<string, IntentComponent>()
  private owners = new Map<string, string>()
  private onCollision: CollisionPolicy
  private warn: (message: string) => void
  private listeners = new Set<() => void>()
  private version = 0

  constructor(options: IntentRegistryOptions = {}) {
    this.onCollision = options.onCollision ?? defaultCollisionPolicy()
    this.warn = options.warn ?? ((message: string) => console.warn(message))
  }

  /** Subscribe to registry changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Monotonic counter, bumped on every mutation. The snapshot for useSyncExternalStore. */
  getVersion(): number {
    return this.version
  }

  private emit(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }

  register(name: string, component: IntentComponent): this {
    this.owners.set(name, CORE_OWNER)
    this.byName.set(name, component)
    this.emit()
    return this
  }

  /**
   * Registers a contributor module's intents. Every key must be prefixed with
   * the contributor name followed by a dot.
   */
  registerNamespaced(
    contributor: string,
    intents: Record<string, IntentComponent>
  ): this {
    if (!contributor) {
      throw new Error("registerNamespaced requires a contributor name")
    }

    const prefix = `${contributor}.`
    for (const name of Object.keys(intents)) {
      if (!name.startsWith(prefix)) {
        throw new Error(
          `intent "${name}" is outside the "${contributor}" namespace; ` +
            `contributor modules may only register intents prefixed "${prefix}"`
        )
      }
    }

    // One notification per call, not one per intent: a module registering
    // eight intents should cost the tree one re-render, not eight. The
    // finally still fires under the "throw" collision policy, so anything
    // already installed before the throw is visible to subscribers.
    let changed = false
    try {
      for (const [name, component] of Object.entries(intents)) {
        changed =
          this.registerContributorIntent(contributor, name, component) ||
          changed
      }
    } finally {
      if (changed) this.emit()
    }
    return this
  }

  /**
   * Installs one already-namespace-checked contributor intent. Returns whether
   * it actually wrote anything, so the caller knows whether to notify.
   *
   * Core intents are never claimable. The namespace check alone does not cover
   * this: a contributor legitimately named "page" passes the prefix test for
   * "page.shell", so ownership, not the name, is what refuses it.
   *
   * Collision policy between contributors: during development a collision must
   * be impossible to miss, so it throws at startup naming both contributors.
   * In production one badly-packaged extension must not take down a dashboard
   * that is mostly unrelated to it, so the first registration wins and the
   * second is logged. Re-registration by the SAME contributor (e.g. a module
   * reloading) is not a collision.
   */
  private registerContributorIntent(
    contributor: string,
    name: string,
    component: IntentComponent
  ): boolean {
    const existing = this.owners.get(name)

    if (existing === CORE_OWNER) {
      const message =
        `intent "${name}" is a core intent and cannot be claimed by ` +
        `contributor "${contributor}"`
      if (this.onCollision === "throw") {
        throw new Error(message)
      }
      this.warn(message)
      return false
    }

    if (existing && existing !== contributor) {
      const message =
        `intent "${name}" is claimed by both "${existing}" and "${contributor}"; ` +
        `"${existing}" registered first and is being kept`
      if (this.onCollision === "throw") {
        throw new Error(message)
      }
      this.warn(message)
      return false
    }

    this.owners.set(name, contributor)
    this.byName.set(name, component)
    return true
  }

  resolve(name: string): IntentComponent | undefined {
    return this.byName.get(name)
  }

  has(name: string): boolean {
    return this.byName.has(name)
  }
}
