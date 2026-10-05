import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import {
  DanglingBadge,
  DisabledProviderBadge,
  EnabledBadge,
  MessageStatusBadge,
  ProtectionBadge,
  VersionBadge,
} from "../src/badges"
import type { MessageStatus } from "../src/wire"

function badge(text: string): HTMLElement {
  return screen.getByText(text, { selector: '[data-slot="badge"]' })
}

describe("MessageStatusBadge", () => {
  const cases: [MessageStatus, string, RegExp][] = [
    ["sent", "Accepted by provider", /outline/],
    ["sending", "Sending", /secondary/],
    ["suppressed", "Suppressed", /secondary/],
    ["failed", "Failed", /destructive/],
    ["queued", "Queued", /outline/],
    ["delivered", "Delivered", /outline/],
    ["bounced", "Bounced", /destructive/],
  ]
  it.each(cases)("%s reads %s with %s", (status, text, variant) => {
    render(<MessageStatusBadge status={status} />)
    expect(badge(text).getAttribute("data-variant")).toMatch(variant)
  })

  it("shows an unknown status as it came, outline", () => {
    render(<MessageStatusBadge status={"retrying" as MessageStatus} />)
    expect(badge("retrying").getAttribute("data-variant")).toMatch(/outline/)
  })
})

describe("the other badges", () => {
  it("enabled recedes and disabled is notable", () => {
    render(<><EnabledBadge enabled /><EnabledBadge enabled={false} /></>)
    expect(badge("Enabled").getAttribute("data-variant")).toMatch(/outline/)
    expect(badge("Disabled").getAttribute("data-variant")).toMatch(/secondary/)
  })

  it("protection names the algorithm only with evidence, and never colours plaintext red", () => {
    render(<><ProtectionBadge protection="aes-256-gcm" /><ProtectionBadge protection="plaintext" /></>)
    expect(badge("Encrypted").getAttribute("data-variant")).toMatch(/outline/)
    expect(badge("Plaintext").getAttribute("data-variant")).toMatch(/secondary/)
    expect(badge("Plaintext").getAttribute("data-variant")).not.toMatch(/destructive/)
  })

  it("a live version recedes and an inactive one is notable", () => {
    render(<><VersionBadge active /><VersionBadge active={false} /></>)
    expect(badge("Live").getAttribute("data-variant")).toMatch(/outline/)
    expect(badge("Inactive").getAttribute("data-variant")).toMatch(/secondary/)
  })

  it("a dangling provider is what you came to find", () => {
    render(<DanglingBadge />)
    expect(badge("Provider deleted").getAttribute("data-variant")).toMatch(/destructive/)
  })

  it("a disabled provider in a send is a warning, not a failure", () => {
    render(<DisabledProviderBadge />)
    expect(badge("Provider disabled").getAttribute("data-variant")).toMatch(/default/)
  })
})
