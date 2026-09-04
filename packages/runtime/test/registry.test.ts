import { describe, expect, it, vi } from "vitest"
import { IntentRegistry } from "../src/registry"

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
      reg.registerNamespaced("billing", { "atom.button": Stub }),
    ).toThrow(/namespace/i)
  })

  it("refuses a contributor name that is empty", () => {
    const reg = new IntentRegistry()

    expect(() => reg.registerNamespaced("", { "x.y": Stub })).toThrow()
  })

  // A prefix match must respect the dot separator, so "billingx" cannot
  // register under "billing".
  it("refuses a contributor prefix that is not dot-separated", () => {
    const reg = new IntentRegistry()

    expect(() =>
      reg.registerNamespaced("billing", { "billingx.thing": Stub }),
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
      reg.registerNamespaced("billing", { [INTENT]: StubTwo }),
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
