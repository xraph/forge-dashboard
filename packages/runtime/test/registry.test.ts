import { describe, expect, it } from "vitest"
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
