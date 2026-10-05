import { describe, expect, it } from "vitest"
import { credentialSummary, plural, statusLabel, STATUS_ORDER } from "../src/format"
import { messagePath, providerPath, providerSendTestPath, templatePath } from "../src/keys"

describe("plural", () => {
  it("uses the singular for one and the plural otherwise, zero included", () => {
    expect(plural(1, "provider")).toBe("1 provider")
    expect(plural(0, "provider")).toBe("0 providers")
    expect(plural(2, "category", "categories")).toBe("2 categories")
  })
})

describe("credentialSummary", () => {
  it("is null with no credentials, so the cell can say none", () => {
    expect(credentialSummary([])).toBeNull()
  })

  it("counts plaintext before encrypted, and never says encrypted without evidence", () => {
    expect(credentialSummary([{ key: "a", protection: "aes-256-gcm", keyId: "k1" }, { key: "b", protection: "aes-256-gcm", keyId: "k1" }, { key: "c", protection: "aes-256-gcm", keyId: "k1" }])).toBe("3 encrypted")
    expect(credentialSummary([{ key: "a", protection: "plaintext" }, { key: "b", protection: "plaintext" }, { key: "c", protection: "aes-256-gcm", keyId: "k1" }])).toBe("2 plaintext, 1 encrypted")
    expect(credentialSummary([{ key: "a", protection: "plaintext" }])).toBe("1 plaintext")
  })
})

describe("statusLabel", () => {
  it("never calls sent delivered", () => {
    expect(statusLabel("sent")).toBe("Accepted by provider")
    for (const status of STATUS_ORDER) {
      if (status !== "delivered") expect(statusLabel(status).toLowerCase()).not.toContain("delivered")
    }
  })
})

describe("paths", () => {
  it("encodes every segment", () => {
    expect(providerPath("hpvd_1")).toBe("/providers/hpvd_1")
    expect(providerSendTestPath("hpvd_1")).toBe("/providers/hpvd_1/send-test")
    expect(templatePath("a/b")).toBe("/templates/a%2Fb")
    expect(messagePath("hmsg_1")).toBe("/messages/hmsg_1")
  })
})
