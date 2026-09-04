import type { IntentComponent } from "./types"

/**
 * Maps intent names to the components that render them.
 *
 * Core intents go in through register. Contributor modules go in through
 * registerNamespaced, which refuses any intent outside the contributor's own
 * namespace so an extension cannot replace a core intent for the whole app.
 */
export class IntentRegistry {
  private byName = new Map<string, IntentComponent>()

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
   * OWNER DECISION, see Step 7. The collision policy lives here.
   */
  private registerContributorIntent(
    contributor: string,
    name: string,
    component: IntentComponent,
  ): void {
    this.byName.set(name, component)
  }

  resolve(name: string): IntentComponent | undefined {
    return this.byName.get(name)
  }

  has(name: string): boolean {
    return this.byName.has(name)
  }
}
