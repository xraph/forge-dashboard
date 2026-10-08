/*
 * The herald contract's wire shapes. Field names are the JSON tags in
 * forgery/herald/extension/contract (project.go and the handlers) at 0325975.
 * Optional fields are the Go `omitempty` ones; `| null` is what Go writes as
 * null. Every slice and map in a response is non-nil, so it arrives as an
 * array or an object, never null.
 */

export type ISODate = string
export type Channel = "email" | "sms" | "push" | "inapp" | "webhook" | "chat"
export type RoutedChannel = "email" | "sms" | "push" | "webhook" | "chat"
export type PrefChannel = "email" | "sms" | "push" | "inapp"
export type MessageStatus =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "bounced"
  | "delivered"
  | "suppressed"
export type Protection = "aes-256-gcm" | "plaintext"
export type Placement = "credential" | "setting"
export type ScopeType = "app" | "org" | "user"
export type ResolveVia = "user" | "org" | "app" | "fallback" | "chosen" | "none"
export type ResolveMatch = "exact" | "language" | "default" | "none"
export type OverviewWindow = "24h" | "7d" | "30d"
export type TemplateField = "subject" | "html" | "text" | "title"

export interface AppRef {
  id: string
  /** "Default app" when id is "". */
  label: string
}
export interface FieldInfo {
  key: string
  label: string
  help?: string
  required: boolean
  secret: boolean
  placement: Placement
}
export interface DriverInfo {
  name: string
  channel: string
  /** null: the driver has no schema. []: it needs nothing (inapp). */
  fields: FieldInfo[] | null
}
export interface EngineInfoResponse {
  app: AppRef
  defaultLocale: string
  maxBatchSize: number
  truncateBodyAt: number
  channels: Channel[]
  drivers: DriverInfo[]
  templateFuncs: string[]
  encryption: { configured: boolean; keyId?: string }
  apiProtected: boolean
}

export interface MessageCount {
  status: MessageStatus
  channel: string
  n: number
}
export interface TemplateRef {
  id: string
  slug: string
  channel?: string
}
export interface OverviewStatsResponse {
  since: ISODate
  counts: MessageCount[]
  providers: { total: number; enabled: number }
  credentials: { plaintext: number; encrypted: number }
  templatesWithoutFallback: TemplateRef[]
}

/** Never a value: key, protection, and the key ID for encrypted values. */
export interface CredentialStatus {
  key: string
  protection: Protection
  keyId?: string
}
export interface ProviderSummary {
  id: string
  name: string
  channel: string
  driver: string
  priority: number
  enabled: boolean
  credentials: CredentialStatus[]
  createdAt: ISODate
  updatedAt: ISODate
}
/** value is omitted when secret, including every setting of a driver with no schema. */
export interface SettingEntry {
  key: string
  value?: string
  secret: boolean
}
export interface RouteUse {
  scope: ScopeType
  scopeId: string
  channel: RoutedChannel
}
export interface ProviderDetail extends ProviderSummary {
  settings: SettingEntry[]
  usedBy: RouteUse[]
}
export interface ProvidersListResponse {
  providers: ProviderSummary[]
}
export interface ProvidersDetailResponse {
  provider: ProviderDetail
}
export interface ProviderResponse {
  provider: ProviderSummary
}
export interface ProvidersCreateRequest {
  name: string
  channel: string
  driver: string
  priority: number
  /** Omitted means false on the server, so it is always sent. */
  enabled: boolean
  credentials?: Record<string, string>
  settings?: Record<string, string>
}
export interface ProvidersUpdateRequest {
  id: string
  name?: string
  priority?: number
  enabled?: boolean
  setCredentials?: Record<string, string>
  removeCredentials?: string[]
  setSettings?: Record<string, string>
  removeSettings?: string[]
}
export interface ProvidersEncryptStoredResponse {
  providers: number
  valuesEncrypted: number
  alreadyEncrypted: number
}
export interface DeleteResponse {
  ok: true
  id: string
}

export interface LocaleState {
  locale: string
  active: boolean
}
export interface TemplateSummary {
  id: string
  slug: string
  name: string
  channel: string
  category: string
  isSystem: boolean
  enabled: boolean
  locales: LocaleState[]
  hasFallback: boolean
  updatedAt: ISODate
}
export interface VariableWire {
  name: string
  type: string
  required: boolean
  default?: string
  description?: string
}
export interface VersionWire {
  id: string
  locale: string
  subject: string
  html: string
  text: string
  title: string
  active: boolean
  createdAt: ISODate
  updatedAt: ISODate
}
export interface ResolutionEntry {
  locale: string
  versionId: string | null
  match: ResolveMatch
}
export interface TemplateDetail extends TemplateSummary {
  variables: VariableWire[]
  versions: VersionWire[]
}
export interface TemplatesListResponse {
  templates: TemplateSummary[]
}
export interface TemplatesDetailResponse {
  template: TemplateDetail
  resolution: ResolutionEntry[]
}
export interface ResolveStep {
  try: string
  match: ResolveMatch
  found: boolean
  versionId?: string
}
export interface TemplatesResolveResponse {
  locale: string
  steps: ResolveStep[]
  versionId: string | null
  match: ResolveMatch
}
export interface Content {
  subject: string
  html: string
  text: string
  title: string
}
export interface TemplatesRenderRequest {
  templateId?: string
  content: Content
  /** Absent: the stored template's variables apply. [] declares none. */
  variables?: VariableWire[]
  data?: Record<string, unknown>
}
export interface FieldOutput {
  field: TemplateField
  output: string
  rendered: boolean
}
export type DiagnosticKind =
  "parse" | "exec" | "escape" | "missing" | "undeclared" | "unprovided"
export interface Diagnostic {
  /** "" for missing and unprovided, which also have line and column 0. */
  field: TemplateField | ""
  /** 1-based; 0 means Go reported none. */
  line: number
  /** 1-based character column; 0 means none (a parse error has none). */
  column: number
  severity: "error" | "warning"
  kind: DiagnosticKind
  message: string
}
export interface PreviewResult {
  fields: FieldOutput[]
  diagnostics: Diagnostic[]
}
export interface TemplatesCreateRequest {
  slug: string
  name: string
  channel: string
  category: string
  version?: { locale: string }
}
export interface TemplateResponse {
  template: TemplateSummary
}
export interface TemplatesResetDefaultsResponse {
  deleted: number
  seeded: number
}

export interface ProviderRef {
  id: string
  /** Always present; "" when the post-send lookup failed. */
  name: string
  driver?: string
  /** Only send.resolve sets it. */
  enabled?: boolean
}
export interface MessageSummary {
  id: string
  recipient: string
  channel: string
  status: MessageStatus
  templateSlug?: string
  provider: ProviderRef | null
  error?: string
  createdAt: ISODate
  sentAt?: ISODate
}
export interface MessageDetail extends MessageSummary {
  subject?: string
  /** The text part only, cut at engine.info's truncateBodyAt bytes. */
  body: string
  metadata: Record<string, string>
  attempts: number
  async: boolean
  envId?: string
  providerMessageId?: string
  template: TemplateRef | null
}
export interface MessagesListResponse {
  messages: MessageSummary[]
  nextCursor?: string
}
export interface MessagesDetailResponse {
  message: MessageDetail
}

export interface SendResolveResponse {
  provider: ProviderRef | null
  via: ResolveVia
  from: { email?: string; name?: string; phone?: string }
}
export interface SendTestRequest {
  channel: string
  recipient: string
  providerId?: string
  template?: string
  locale?: string
  data?: Record<string, unknown>
  subject?: string
  body?: string
  userId?: string
}
export interface SendTestResponse {
  messageId?: string
  status: MessageStatus
  provider: ProviderRef | null
  providerMessageId?: string
  error?: string
  logged: boolean
}

export interface NotificationWire {
  id: string
  userId: string
  type: string
  title: string
  body?: string
  actionUrl?: string
  imageUrl?: string
  read: boolean
  readAt?: ISODate
  metadata: Record<string, string>
  expiresAt?: ISODate
  createdAt: ISODate
}
export interface InboxListResponse {
  notifications: NotificationWire[]
  unread: number
  nextCursor?: string
}
export interface InboxOKResponse {
  ok: true
  id?: string
}

/** null: never set, so the user gets it. */
export interface ChannelPreferenceWire {
  email: boolean | null
  sms: boolean | null
  push: boolean | null
  inapp: boolean | null
}
export interface PreferenceWire {
  id: string
  userId: string
  overrides: Record<string, ChannelPreferenceWire>
  updatedAt: ISODate
}
export interface PreferencesGetResponse {
  preference: PreferenceWire | null
  knownTypes: string[]
}
export interface PreferencesOptOutResponse {
  preference: PreferenceWire
}

export interface RoutedProvider {
  id: string
  /** Omitted when dangling. */
  name?: string
  dangling: boolean
}
export interface ScopeRule {
  id: string
  scope: ScopeType
  /** The app ID for an app rule, which can be "". */
  scopeId: string
  providers: Partial<Record<RoutedChannel, RoutedProvider>>
  fromEmail?: string
  fromName?: string
  fromPhone?: string
  defaultLocale?: string
  /** Always true: Send never reads a rule's default locale. */
  defaultLocaleUnused: boolean
  updatedAt: ISODate
}
export interface ScopesListResponse {
  rules: ScopeRule[]
}
export interface ScopesSetRequest {
  scope: ScopeType
  scopeId?: string
  emailProviderId?: string
  smsProviderId?: string
  pushProviderId?: string
  webhookProviderId?: string
  chatProviderId?: string
  fromEmail?: string
  fromName?: string
  fromPhone?: string
}
export interface ScopesSetResponse {
  rule: ScopeRule
}

/** templates.update: pointers in Go, so an absent field is left alone. Slug and channel can't change. */
export interface TemplatesUpdateRequest {
  id: string
  name?: string
  category?: string
  enabled?: boolean
  variables?: VariableWire[]
}
export interface TemplatesDeleteRequest {
  id: string
}
/** versions.create. `active` defaults to true on the server, so the workspace always sends it. */
export interface VersionsCreateRequest {
  templateId: string
  locale: string
  subject: string
  html: string
  text: string
  title: string
  active?: boolean
}
/** versions.update: pointers, so only the changed fields travel. A version's locale can't change. */
export interface VersionsUpdateRequest {
  templateId: string
  versionId: string
  subject?: string
  html?: string
  text?: string
  title?: string
  active?: boolean
}
export interface VersionsDeleteRequest {
  templateId: string
  versionId: string
}
export interface VersionResponse {
  version: VersionWire
}
