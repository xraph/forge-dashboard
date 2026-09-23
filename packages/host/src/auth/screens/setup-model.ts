import type {
  CompleteSetupInput,
  SetupEnvironmentDefaults,
  SetupPlatformDefaults,
  SetupStatus,
} from "@forge-go/dashboard-plugin"

export interface MetadataRow {
  id: string
  key: string
  value: string
}

export interface SetupDraft {
  platform: SetupPlatformDefaults & {
    metadata: MetadataRow[]
    slugTouched: boolean
  }
  environment: SetupEnvironmentDefaults & {
    metadata: MetadataRow[]
    slugTouched: boolean
  }
  administrator: {
    name: string
    email: string
    password: string
    confirmPassword: string
  }
}

export type SetupStep = "platform" | "environment" | "administrator"
export type SetupFieldErrors = Record<string, string>

let metadataRowSequence = 0

export function createMetadataRow(): MetadataRow {
  metadataRowSequence += 1
  return { id: `metadata-${metadataRowSequence}`, key: "", value: "" }
}

export function slugifySetupName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function createSetupDraft(status: SetupStatus): SetupDraft {
  return {
    platform: {
      name: status.platform?.name ?? "Forge",
      slug: status.platform?.slug ?? "forge",
      logo: status.platform?.logo ?? "",
      metadata: [],
      slugTouched: false,
    },
    environment: {
      name: status.environment?.name ?? "Development",
      slug: status.environment?.slug ?? "development",
      type: status.environment?.type ?? "development",
      isDefault: status.environment?.isDefault,
      color: status.environment?.color ?? "#2563eb",
      description: status.environment?.description ?? "",
      metadata: [],
      slugTouched: false,
    },
    administrator: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  }
}

export function updateSetupName(
  draft: SetupDraft,
  section: "platform" | "environment",
  name: string
): SetupDraft {
  const current = draft[section]
  return {
    ...draft,
    [section]: {
      ...current,
      name,
      slug: current.slugTouched ? current.slug : slugifySetupName(name),
    },
  }
}

function validateMetadata(
  rows: MetadataRow[],
  path: string,
  errors: SetupFieldErrors
) {
  if (rows.length > 20) {
    errors[path] = "Add no more than 20 metadata entries."
  }

  const seen = new Set<string>()
  rows.forEach((row, index) => {
    const key = row.key.trim()
    const value = row.value.trim()
    const keyPath = `${path}.${index}.key`
    const valuePath = `${path}.${index}.value`

    if (!key) errors[keyPath] = "Enter a metadata key."
    else if (key.length > 64) errors[keyPath] = "Use 64 characters or fewer."
    else if (seen.has(key)) errors[keyPath] = "Metadata keys must be unique."

    if (key) seen.add(key)
    if (!value) errors[valuePath] = "Enter a metadata value."
    else if (value.length > 512)
      errors[valuePath] = "Use 512 characters or fewer."
  })
}

function validateNameAndSlug(
  value: { name: string; slug: string },
  path: string,
  errors: SetupFieldErrors
) {
  const name = value.name.trim()
  const slug = value.slug.trim()
  if (!name) errors[`${path}.name`] = "Enter a name."
  else if (name.length > 80)
    errors[`${path}.name`] = "Use 80 characters or fewer."

  if (!slug) errors[`${path}.slug`] = "Enter a slug."
  else if (slug.length > 63)
    errors[`${path}.slug`] = "Use 63 characters or fewer."
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    errors[`${path}.slug`] =
      "Use lowercase letters, numbers, and single hyphens."
  }
}

export function validateSetupStep(
  draft: SetupDraft,
  step: SetupStep
): SetupFieldErrors {
  const errors: SetupFieldErrors = {}

  if (step === "platform") {
    validateNameAndSlug(draft.platform, "platform", errors)
    const logo = draft.platform.logo?.trim()
    if (logo && !logo.startsWith("/") && !/^https?:\/\//i.test(logo)) {
      errors["platform.logo"] = "Use an HTTP, HTTPS, or root-relative URL."
    }
    validateMetadata(draft.platform.metadata, "platform.metadata", errors)
  }

  if (step === "environment") {
    validateNameAndSlug(draft.environment, "environment", errors)
    if (
      !["development", "staging", "production"].includes(draft.environment.type)
    ) {
      errors["environment.type"] = "Choose a valid environment type."
    }
    if ((draft.environment.description?.trim().length ?? 0) > 240) {
      errors["environment.description"] = "Use 240 characters or fewer."
    }
    validateMetadata(draft.environment.metadata, "environment.metadata", errors)
  }

  if (step === "administrator") {
    const email = draft.administrator.email.trim()
    if (!email) errors["administrator.email"] = "Enter an email address."
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors["administrator.email"] = "Enter a valid email address."
    }
    if (!draft.administrator.password) {
      errors["administrator.password"] = "Enter a password."
    }
    if (draft.administrator.confirmPassword !== draft.administrator.password) {
      errors["administrator.confirmPassword"] = "Passwords must match."
    }
  }

  return errors
}

function metadataToRecord(rows: MetadataRow[]) {
  if (rows.length === 0) return undefined
  return Object.fromEntries(
    rows.map((row) => [row.key.trim(), row.value.trim()])
  )
}

export function buildCompleteSetupInput(draft: SetupDraft): CompleteSetupInput {
  const name = draft.administrator.name.trim()
  const logo = draft.platform.logo?.trim()
  const platformMetadata = metadataToRecord(draft.platform.metadata)
  const color = draft.environment.color?.trim()
  const description = draft.environment.description?.trim()
  const environmentMetadata = metadataToRecord(draft.environment.metadata)

  return {
    email: draft.administrator.email.trim(),
    password: draft.administrator.password,
    ...(name ? { name } : {}),
    platform: {
      name: draft.platform.name.trim(),
      slug: draft.platform.slug.trim(),
      ...(logo ? { logo } : {}),
      ...(platformMetadata ? { metadata: platformMetadata } : {}),
    },
    environment: {
      name: draft.environment.name.trim(),
      slug: draft.environment.slug.trim(),
      type: draft.environment.type,
      ...(color ? { color } : {}),
      ...(description ? { description } : {}),
      ...(environmentMetadata ? { metadata: environmentMetadata } : {}),
    },
  }
}
