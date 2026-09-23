import { describe, expect, it } from "vitest"
import type { SetupStatus } from "@forge-go/dashboard-plugin"
import {
  buildCompleteSetupInput,
  createSetupDraft,
  slugifySetupName,
  updateSetupName,
  validateSetupStep,
} from "../src/auth/screens/setup-model"

const status: SetupStatus = {
  pending: true,
  platform: {
    name: "TwinOS Office",
    slug: "twinos-office",
    logo: "https://example.com/logo.svg",
  },
  environment: {
    name: "Development",
    slug: "development",
    type: "development",
    isDefault: true,
    color: "#2563eb",
    description: "Local development",
  },
}

describe("setup model", () => {
  it("creates URL-safe slugs", () => {
    expect(slugifySetupName("  TwinOS Office  ")).toBe("twinos-office")
    expect(slugifySetupName("R&D / Local")).toBe("r-d-local")
  })

  it("creates a draft from anonymous defaults without synthesizing credentials", () => {
    const draft = createSetupDraft(status)

    expect(draft.platform.name).toBe("TwinOS Office")
    expect(draft.environment.type).toBe("development")
    expect(draft.administrator).toEqual({
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    })
  })

  it("regenerates only untouched slugs when a name changes", () => {
    const draft = createSetupDraft(status)
    const generated = updateSetupName(draft, "platform", "TwinOS Control Room")

    expect(generated.platform.slug).toBe("twinos-control-room")

    generated.platform.slug = "office"
    generated.platform.slugTouched = true
    const preserved = updateSetupName(generated, "platform", "Renamed platform")
    expect(preserved.platform.slug).toBe("office")
  })

  it("builds the exact trimmed wire payload and omits empty metadata", () => {
    const draft = createSetupDraft(status)
    draft.platform.name = "  TwinOS Office  "
    draft.platform.logo = "  https://example.com/logo.svg  "
    draft.platform.metadata = [
      { id: "one", key: " region ", value: " us-central " },
    ]
    draft.environment.description = "  Local development  "
    draft.environment.metadata = []
    draft.administrator = {
      name: "  Rex  ",
      email: "  rex@example.com  ",
      password: " keep spaces ",
      confirmPassword: " keep spaces ",
    }

    expect(buildCompleteSetupInput(draft)).toEqual({
      email: "rex@example.com",
      password: " keep spaces ",
      name: "Rex",
      platform: {
        name: "TwinOS Office",
        slug: "twinos-office",
        logo: "https://example.com/logo.svg",
        metadata: { region: "us-central" },
      },
      environment: {
        name: "Development",
        slug: "development",
        type: "development",
        color: "#2563eb",
        description: "Local development",
      },
    })
  })

  it("validates required names, slugs, slug syntax, and environment type", () => {
    const draft = createSetupDraft(status)
    draft.platform.name = ""
    draft.platform.slug = "Not Valid"
    draft.environment.name = ""
    draft.environment.slug = "-bad-"
    draft.environment.type = "preview" as "development"

    expect(validateSetupStep(draft, "platform")).toMatchObject({
      "platform.name": expect.any(String),
      "platform.slug": expect.any(String),
    })
    expect(validateSetupStep(draft, "environment")).toMatchObject({
      "environment.name": expect.any(String),
      "environment.slug": expect.any(String),
      "environment.type": expect.any(String),
    })
  })

  it("validates administrator email, password, and confirmation", () => {
    const draft = createSetupDraft(status)
    draft.administrator.email = "invalid"
    draft.administrator.password = ""
    draft.administrator.confirmPassword = "different"

    expect(validateSetupStep(draft, "administrator")).toMatchObject({
      "administrator.email": expect.any(String),
      "administrator.password": expect.any(String),
      "administrator.confirmPassword": expect.any(String),
    })
  })

  it("validates metadata cells, duplicates, counts, and bounded lengths", () => {
    const draft = createSetupDraft(status)
    draft.platform.metadata = [
      { id: "blank", key: "", value: "" },
      { id: "first", key: "region", value: "central" },
      { id: "duplicate", key: " region ", value: "east" },
      { id: "long-key", key: "k".repeat(65), value: "ok" },
      { id: "long-value", key: "notes", value: "v".repeat(513) },
      ...Array.from({ length: 16 }, (_, index) => ({
        id: `extra-${index}`,
        key: `key-${index}`,
        value: "value",
      })),
    ]

    const errors = validateSetupStep(draft, "platform")
    expect(errors["platform.metadata.0.key"]).toBeDefined()
    expect(errors["platform.metadata.0.value"]).toBeDefined()
    expect(errors["platform.metadata.2.key"]).toBeDefined()
    expect(errors["platform.metadata.3.key"]).toBeDefined()
    expect(errors["platform.metadata.4.value"]).toBeDefined()
    expect(errors["platform.metadata"]).toBeDefined()
  })
})
