import { describe, expect, it, vi } from "vitest"
import { IntentRegistry, resolveCollisionPolicy } from "../src/registry"

function Stub() {
  return null
}

describe("IntentRegistry", () => {
  it("resolves a registered intent", () => {
    const reg = new IntentRegistry()
    reg.register("atom.button", Stub)

    expect(reg.resolve("atom.button")).toBe(Stub)
    expect(reg.has("atom.button")).toBe(true)
  })

  it("returns undefined for an unregistered intent", () => {
    const reg = new IntentRegistry()

    expect(reg.resolve("nope.missing")).toBeUndefined()
    expect(reg.has("nope.missing")).toBe(false)
  })

  // Spec section 2: a contributor module may only register intents prefixed
  // with its own name. Without this, any extension can replace atom.button
  // for the whole application.
  it("accepts namespaced intents that match the contributor", () => {
    const reg = new IntentRegistry()
    reg.registerNamespaced("billing", {
      "billing.invoice-table": Stub,
      "billing.usage-meter": Stub,
    })

    expect(reg.has("billing.invoice-table")).toBe(true)
    expect(reg.has("billing.usage-meter")).toBe(true)
  })

  it("refuses an intent that escapes its contributor namespace", () => {
    const reg = new IntentRegistry()

    expect(() =>
      reg.registerNamespaced("billing", { "atom.button": Stub })
    ).toThrow(/namespace/i)
  })

  it("refuses a contributor name that is empty", () => {
    const reg = new IntentRegistry()

    // Matched on the guard's own wording, not a bare toThrow. With the guard
    // removed the prefix becomes "." and the namespace check throws instead,
    // and a bare toThrow cannot tell those two errors apart - so the test
    // would keep passing with the thing it exists to protect deleted.
    expect(() => reg.registerNamespaced("", { "x.y": Stub })).toThrow(
      /requires a contributor name/
    )
  })

  // A prefix match must respect the dot separator, so "billingx" cannot
  // register under "billing".
  it("refuses a contributor prefix that is not dot-separated", () => {
    const reg = new IntentRegistry()

    expect(() =>
      reg.registerNamespaced("billing", { "billingx.thing": Stub })
    ).toThrow(/namespace/i)
  })
})

function StubTwo() {
  return null
}

// Namespace enforcement requires an intent's key to start with
// "<contributor>.". Two DIFFERENT contributor strings can only legitimately
// both pass that check for the exact same intent key when one contributor
// name nests inside the other (e.g. "billing" and "billing.reports" both
// validly own "billing.reports.summary"). That is the realistic shape of a
// same-intent collision between distinct contributors without touching the
// namespace-enforcement loop itself.
const INTENT = "billing.reports.summary"

describe("IntentRegistry collision policy", () => {
  it('with onCollision "throw", a second contributor claiming the same intent throws naming both contributors', () => {
    const reg = new IntentRegistry({ onCollision: "throw" })
    reg.registerNamespaced("billing", { [INTENT]: Stub })

    let thrown: unknown
    try {
      reg.registerNamespaced("billing.reports", { [INTENT]: StubTwo })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    const message = (thrown as Error).message
    expect(message).toContain("billing")
    expect(message).toContain("billing.reports")
  })

  it('with onCollision "warn" and an injected sink, the second registration is skipped, the first still resolves, and the sink is called exactly once', () => {
    const warn = vi.fn()
    const reg = new IntentRegistry({ onCollision: "warn", warn })
    reg.registerNamespaced("billing", { [INTENT]: Stub })

    reg.registerNamespaced("billing.reports", { [INTENT]: StubTwo })

    expect(reg.resolve(INTENT)).toBe(Stub)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("does not treat the same contributor re-registering its own intent as a collision", () => {
    const warn = vi.fn()
    const reg = new IntentRegistry({ onCollision: "throw", warn })
    reg.registerNamespaced("billing", { [INTENT]: Stub })

    expect(() =>
      reg.registerNamespaced("billing", { [INTENT]: StubTwo })
    ).not.toThrow()

    expect(reg.resolve(INTENT)).toBe(StubTwo)
    expect(warn).not.toHaveBeenCalled()
  })

  it("produces no warn call when there is no collision at all", () => {
    const warn = vi.fn()
    const reg = new IntentRegistry({ onCollision: "warn", warn })

    reg.registerNamespaced("billing", { [INTENT]: Stub })

    expect(warn).not.toHaveBeenCalled()
  })
})

// register() installs core intents. Namespace enforcement alone does not
// protect them: a contributor legitimately named "page" passes the prefix
// check for "page.shell". Ownership is what refuses it.
describe("IntentRegistry core intent protection", () => {
  it("refuses a contributor claiming a core intent inside its own namespace, under the throw policy", () => {
    const reg = new IntentRegistry({ onCollision: "throw" })
    reg.register("page.shell", Stub)

    let thrown: unknown
    try {
      reg.registerNamespaced("page", { "page.shell": StubTwo })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toMatch(/core intent/)
    expect((thrown as Error).message).toContain("page.shell")
  })

  it("skips a contributor claiming a core intent under the warn policy, and the core component still resolves", () => {
    const warn = vi.fn()
    const reg = new IntentRegistry({ onCollision: "warn", warn })
    reg.register("page.shell", Stub)

    reg.registerNamespaced("page", { "page.shell": StubTwo })

    expect(reg.resolve("page.shell")).toBe(Stub)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/core intent/)
  })

  it("still lets a contributor register its own non-core intents in a core-named namespace", () => {
    const reg = new IntentRegistry({ onCollision: "throw" })
    reg.register("page.shell", Stub)

    reg.registerNamespaced("page", { "page.settings": StubTwo })

    expect(reg.resolve("page.shell")).toBe(Stub)
    expect(reg.resolve("page.settings")).toBe(StubTwo)
  })
})

// The one function whose behaviour differs between test and production. It
// decides whether a mispackaged extension takes a production dashboard down
// at startup, so it is tested directly rather than through the constructor.
describe("resolveCollisionPolicy", () => {
  it("throws loudly in development", () => {
    expect(resolveCollisionPolicy({ DEV: true })).toBe("throw")
  })

  it("warns in production", () => {
    expect(resolveCollisionPolicy({ DEV: false })).toBe("warn")
  })

  it("warns when there is no env at all, such as a server render", () => {
    expect(resolveCollisionPolicy(undefined)).toBe("warn")
  })

  it("warns when an env exists but says nothing about DEV", () => {
    expect(resolveCollisionPolicy({})).toBe("warn")
  })
})

describe("IntentRegistry subscriptions", () => {
  it("notifies subscribers and bumps the version when a core intent is registered", () => {
    const reg = new IntentRegistry()
    const listener = vi.fn()
    reg.subscribe(listener)
    const before = reg.getVersion()

    reg.register("atom.button", Stub)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(reg.getVersion()).toBeGreaterThan(before)
  })

  it("notifies once per registerNamespaced call, not once per intent", () => {
    const reg = new IntentRegistry()
    const listener = vi.fn()
    reg.subscribe(listener)

    reg.registerNamespaced("billing", {
      "billing.one": Stub,
      "billing.two": StubTwo,
    })

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("does not notify when every registration is skipped as a collision", () => {
    const warn = vi.fn()
    const reg = new IntentRegistry({ onCollision: "warn", warn })
    reg.registerNamespaced("billing", { [INTENT]: Stub })
    const listener = vi.fn()
    reg.subscribe(listener)
    const before = reg.getVersion()

    reg.registerNamespaced("billing.reports", { [INTENT]: StubTwo })

    expect(listener).not.toHaveBeenCalled()
    expect(reg.getVersion()).toBe(before)
  })

  it("stops notifying after unsubscribe", () => {
    const reg = new IntentRegistry()
    const listener = vi.fn()
    const unsubscribe = reg.subscribe(listener)

    unsubscribe()
    reg.register("atom.button", Stub)

    expect(listener).not.toHaveBeenCalled()
  })
})
