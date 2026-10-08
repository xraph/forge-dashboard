import type {
  EngineInfoResponse,
  MessageDetail,
  MessageSummary,
  NotificationWire,
  ProviderDetail,
  ProviderSummary,
  ScopeRule,
  TemplateDetail,
  TemplateSummary,
} from "../src/wire"

/** Test data shaped like the wire. Field names are Herald's JSON tags. */

export const ENGINE: EngineInfoResponse = {
  app: { id: "app_demo", label: "app_demo" },
  defaultLocale: "en",
  maxBatchSize: 100,
  truncateBodyAt: 4096,
  channels: ["email", "sms", "push", "inapp", "webhook", "chat"],
  drivers: [
    { name: "inapp", channel: "inapp", fields: [] },
    { name: "legacy-sms", channel: "sms", fields: null },
    {
      name: "resend",
      channel: "email",
      fields: [
        {
          key: "api_key",
          label: "API key",
          required: true,
          secret: true,
          placement: "credential",
        },
        {
          key: "base_url",
          label: "API base URL",
          help: "Leave empty for Resend's own API.",
          required: false,
          secret: false,
          placement: "setting",
        },
      ],
    },
    {
      name: "smtp",
      channel: "email",
      fields: [
        {
          key: "host",
          label: "Host",
          required: true,
          secret: false,
          placement: "setting",
        },
        {
          key: "port",
          label: "Port",
          help: "Usually 587, or 465 with implicit TLS.",
          required: true,
          secret: false,
          placement: "setting",
        },
        {
          key: "username",
          label: "Username",
          required: false,
          secret: false,
          placement: "credential",
        },
        {
          key: "password",
          label: "Password",
          required: false,
          secret: true,
          placement: "credential",
        },
        {
          key: "from",
          label: "From address",
          help: "Used when no routing rule sets one.",
          required: false,
          secret: false,
          placement: "setting",
        },
      ],
    },
    {
      name: "twilio",
      channel: "sms",
      fields: [
        {
          key: "account_sid",
          label: "Account SID",
          required: true,
          secret: false,
          placement: "credential",
        },
        {
          key: "auth_token",
          label: "Auth token",
          required: true,
          secret: true,
          placement: "credential",
        },
        {
          key: "from_number",
          label: "From number",
          required: true,
          secret: false,
          placement: "setting",
        },
      ],
    },
  ],
  templateFuncs: [
    "default",
    "formatDate",
    "lower",
    "now",
    "title",
    "truncate",
    "upper",
  ],
  encryption: { configured: true, keyId: "k1" },
  apiProtected: false,
}

export function engine(
  over: Partial<EngineInfoResponse> = {}
): EngineInfoResponse {
  return { ...ENGINE, ...over }
}

export function providerSummary(
  over: Partial<ProviderSummary> = {}
): ProviderSummary {
  return {
    id: "hpvd_01j00000000000000000000001",
    name: "Primary SMTP",
    channel: "email",
    driver: "smtp",
    priority: 0,
    enabled: true,
    credentials: [
      { key: "password", protection: "aes-256-gcm", keyId: "k1" },
      { key: "username", protection: "aes-256-gcm", keyId: "k1" },
    ],
    createdAt: "2026-09-20T10:00:00Z",
    updatedAt: "2026-09-23T10:00:00Z",
    ...over,
  }
}

export function providerDetail(
  over: Partial<ProviderDetail> = {}
): ProviderDetail {
  return {
    ...providerSummary(),
    settings: [
      { key: "from", value: "no-reply@example.com", secret: false },
      { key: "host", value: "smtp.example.com", secret: false },
      { key: "port", value: "587", secret: false },
    ],
    usedBy: [{ scope: "app", scopeId: "app_demo", channel: "email" }],
    ...over,
  }
}

export function templateSummary(
  over: Partial<TemplateSummary> = {}
): TemplateSummary {
  return {
    id: "htpl_01j00000000000000000000015",
    slug: "billing.receipt",
    name: "Receipt",
    channel: "email",
    category: "transactional",
    isSystem: false,
    enabled: true,
    locales: [
      { locale: "", active: true },
      { locale: "en", active: true },
      { locale: "fr", active: false },
    ],
    hasFallback: true,
    updatedAt: "2026-09-23T10:00:00Z",
    ...over,
  }
}

export function templateDetail(
  over: Partial<TemplateDetail> = {}
): TemplateDetail {
  return {
    ...templateSummary(),
    variables: [
      { name: "customer_name", type: "string", required: true },
      { name: "amount", type: "string", required: true },
      { name: "invoice_url", type: "url", required: false },
    ],
    versions: [
      {
        id: "htpv_01j00000000000000000000025",
        locale: "",
        subject: "Your receipt",
        html: "<p>Hi {{.customer_name}}</p>",
        text: "Hi {{.customer_name}}",
        title: "",
        active: true,
        createdAt: "2026-09-20T10:00:00Z",
        updatedAt: "2026-09-20T10:00:00Z",
      },
      {
        id: "htpv_01j00000000000000000000026",
        locale: "en",
        subject: "Your {{.amount}} receipt",
        html: "<p>Thanks {{.customer_name}}</p>",
        text: "Thanks {{.customer_name}}",
        title: "",
        active: true,
        createdAt: "2026-09-20T10:00:00Z",
        updatedAt: "2026-09-20T10:00:00Z",
      },
    ],
    ...over,
  }
}

export function messageSummary(
  over: Partial<MessageSummary> = {}
): MessageSummary {
  return {
    id: "hmsg_01j00000000000000000001000",
    recipient: "ada@example.com",
    channel: "email",
    status: "sent",
    templateSlug: "auth.welcome",
    provider: {
      id: "hpvd_01j00000000000000000000001",
      name: "Primary SMTP",
      driver: "smtp",
    },
    createdAt: "2026-09-23T10:00:00Z",
    sentAt: "2026-09-23T10:00:01Z",
    ...over,
  }
}

export function messageDetail(
  over: Partial<MessageDetail> = {}
): MessageDetail {
  return {
    ...messageSummary(),
    subject: "Welcome to Example!",
    body: "Hi Ada,\n\nThanks for joining Example.",
    metadata: { source: "api" },
    attempts: 1,
    async: false,
    providerMessageId: "1000.msg@smtp.example.com",
    template: {
      id: "htpl_01j00000000000000000000011",
      slug: "auth.welcome",
      channel: "email",
    },
    ...over,
  }
}

export function notification(
  over: Partial<NotificationWire> = {}
): NotificationWire {
  return {
    id: "hinb_01j00000000000000000002000",
    userId: "usr_ada",
    type: "auth.welcome",
    title: "Welcome to Example",
    body: "Open the app for details.",
    read: false,
    metadata: {},
    createdAt: "2026-09-23T10:00:00Z",
    ...over,
  }
}

export function scopeRule(over: Partial<ScopeRule> = {}): ScopeRule {
  return {
    id: "hscf_01j00000000000000000004000",
    scope: "app",
    scopeId: "app_demo",
    providers: {
      email: {
        id: "hpvd_01j00000000000000000000001",
        name: "Primary SMTP",
        dangling: false,
      },
    },
    fromEmail: "hello@example.com",
    fromName: "Example",
    defaultLocale: "en",
    defaultLocaleUnused: true,
    updatedAt: "2026-09-23T10:00:00Z",
    ...over,
  }
}
