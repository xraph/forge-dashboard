import { useState } from "react"
import {
  defineSubPlugin,
  PluginLink,
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@forge-go/dashboard-kit/components/tabs"
import {
  QueryBoundary,
  CommandAlert,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { Bell, FileText, Plus, Send } from "@forge-go/dashboard-kit/icons"
import {
  Panel,
  PageLink,
  ResourceTable,
  type Column,
} from "../components/presentation"
import { settingsPanelFor, SETTINGS_INTENTS } from "./settings-panel"

interface Version {
  id: string
  template_id: string
  locale: string
  subject?: string
  title?: string
  html?: string
  text?: string
  active: boolean
}
interface Template {
  id: string
  slug: string
  name: string
  channel: string
  category: string
  enabled: boolean
  is_system: boolean
  variables?: { name: string; default?: string }[]
  versions?: Version[]
}
interface TemplateList {
  templates: Template[]
}
interface Mapping {
  action: string
  template: string
  channels: string[]
  enabled: boolean
}
interface Ack {
  ok: boolean
  id?: string
}
interface Preview {
  subject?: string
  title?: string
  text?: string
  html?: string
}

const channels = ["email", "sms", "inapp", "push"]
const fieldClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <Label className="grid min-w-0 gap-1.5">
      <span>{label}</span>
      {children}
    </Label>
  )
}

export function NotificationsPage() {
  const query = useQuery<TemplateList>("notification.templates.list")
  const mappings = useQuery<{ mappings: Mapping[] }>(
    "notification.mappings.list"
  )
  const reset = useCommand<Ack>("notification.templates.resetDefaults")
  const [confirmReset, setConfirmReset] = useState(false)
  const [channel, setChannel] = useState("all")
  const [search, setSearch] = useState("")
  const columns: Column<Template>[] = [
    {
      id: "name",
      header: "Template",
      cell: (item) => (
        <div className="min-w-0">
          <PluginLink
            to={`/notifications/templates/${item.id}`}
            className="font-medium"
          >
            {item.name}
          </PluginLink>
          <span className="ml-2 font-mono text-xs text-muted-foreground">
            {item.slug}
          </span>
        </div>
      ),
    },
    {
      id: "channel",
      header: "Channel",
      cell: (item) => <span className="font-mono text-xs">{item.channel}</span>,
    },
    { id: "category", header: "Category", cell: (item) => item.category },
    {
      id: "status",
      header: "Status",
      cell: (item) => (
        <Badge variant="ghost" className="gap-1 px-0">
          <span
            className={`size-1.5 rounded-full ${item.enabled ? "bg-emerald-500" : "bg-muted-foreground"}`}
          />
          {item.enabled ? "Enabled" : "Disabled"}
        </Badge>
      ),
    },
    {
      id: "locales",
      header: "Locales",
      cell: (item) =>
        item.versions?.map((version) => version.locale).join(", ") || "None",
    },
  ]
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title="Notifications"
        actions={
          <div className="flex flex-wrap gap-2">
            <PageLink to="/notifications/send">Send notification</PageLink>
            <PageLink to="/notifications/templates/new" primary>
              New template
            </PageLink>
          </div>
        }
      />
      <CommandAlert error={reset.error} title="Could not complete action" />
      <Tabs defaultValue="templates">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b">
          <TabsList variant="line" aria-label="Notification sections">
            <TabsTrigger value="templates">
              Templates
              {query.data && (
                <span className="font-mono text-xs text-muted-foreground">
                  {query.data.templates?.length ?? 0}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="mappings">
              Event mappings
              {mappings.data && (
                <span className="font-mono text-xs text-muted-foreground">
                  {mappings.data.mappings?.length ?? 0}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-1 pb-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmReset(true)}
            >
              Restore defaults
            </Button>
            <Button
              nativeButton={false}
              role="link"
              variant="ghost"
              size="sm"
              render={
                <PluginLink to="/notifications/settings">Settings</PluginLink>
              }
            >
              Settings
            </Button>
          </div>
        </div>
        <TabsContent value="templates" className="pt-2">
          <QueryBoundary title="Notifications" query={query}>
            {(data) => {
              const templates = (data.templates ?? []).filter(
                (item) =>
                  (channel === "all" || item.channel === channel) &&
                  `${item.name} ${item.slug}`
                    .toLowerCase()
                    .includes(search.toLowerCase())
              )
              const countByChannel = (name: string) =>
                (data.templates ?? []).filter((item) => item.channel === name)
                  .length
              return (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Input
                      aria-label="Search templates"
                      placeholder="Search templates"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      className="min-w-40 flex-1 sm:w-64 sm:flex-none"
                    />
                    <select
                      aria-label="Channel"
                      className={`${fieldClass} max-w-36 sm:max-w-40`}
                      value={channel}
                      onChange={(event) => setChannel(event.target.value)}
                    >
                      <option value="all">All channels</option>
                      {channels.map((item) => (
                        <option key={item} value={item}>
                          {item} ({countByChannel(item)})
                        </option>
                      ))}
                    </select>
                  </div>
                  {templates.length ? (
                    <ResourceTable
                      appearance="quiet"
                      columns={columns}
                      rows={templates}
                      rowKey={(item) => item.id}
                      caption="Notification templates"
                      emptyMessage="No templates yet."
                    />
                  ) : (
                    <ZeroState
                      title={
                        search || channel !== "all"
                          ? "No matching templates"
                          : "No templates yet"
                      }
                      body={
                        search || channel !== "all"
                          ? "Try another name or channel."
                          : "Create a template to define the content sent to recipients."
                      }
                      illustration={<FileText className="size-6" />}
                      action={
                        !(search || channel !== "all") && (
                          <PageLink to="/notifications/templates/new" primary>
                            Create template
                          </PageLink>
                        )
                      }
                    />
                  )}
                </div>
              )
            }}
          </QueryBoundary>
        </TabsContent>
        <TabsContent value="mappings" className="pt-2">
          <QueryBoundary title="Notification mappings" query={mappings}>
            {(data) =>
              data.mappings?.length ? (
                <ResourceTable<Mapping>
                  appearance="quiet"
                  columns={[
                    {
                      id: "action",
                      header: "Event",
                      cell: (item) => (
                        <span className="font-mono text-xs">{item.action}</span>
                      ),
                    },
                    {
                      id: "template",
                      header: "Template",
                      cell: (item) => item.template,
                    },
                    {
                      id: "channels",
                      header: "Channels",
                      cell: (item) => item.channels.join(", "),
                    },
                    {
                      id: "status",
                      header: "Status",
                      cell: (item) => (
                        <Badge variant="ghost" className="gap-1 px-0">
                          <span
                            className={`size-1.5 rounded-full ${item.enabled ? "bg-emerald-500" : "bg-muted-foreground"}`}
                          />
                          {item.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      ),
                    },
                  ]}
                  rows={data.mappings}
                  rowKey={(item) => item.action}
                  caption="Notification event mappings"
                  emptyMessage="No event mappings configured."
                />
              ) : (
                <ZeroState
                  title="No event mappings"
                  body="Map an Authsome event to a template in the notification plugin configuration."
                  illustration={<Bell className="size-6" />}
                />
              )
            }
          </QueryBoundary>
        </TabsContent>
      </Tabs>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Restore default templates?"
        description="System templates will be restored to their defaults. Custom templates stay available."
        confirmLabel="Restore defaults"
        pending={reset.loading}
        onConfirm={() =>
          void reset.execute({}).then((result) => {
            if (result) {
              setConfirmReset(false)
              void query.refetch()
            }
          })
        }
      />
    </section>
  )
}

export function NotificationCreatePage() {
  const create = useCommand<Ack>("notification.templates.create")
  const [created, setCreated] = useState("")
  const [form, setForm] = useState({
    name: "",
    slug: "",
    channel: "email",
    category: "transactional",
    locale: "en",
    subject: "",
    title: "",
    html: "",
    text: "",
  })
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const result = await create.execute(form)
    if (result?.id) setCreated(result.id)
  }
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="New notification template"
        actions={<PageLink to="/notifications">Back to templates</PageLink>}
      />
      <CommandAlert title="Could not create template" error={create.error} />
      {created && (
        <Panel title="Template created">
          <PluginLink
            to={`/notifications/templates/${created}`}
            className="text-sm underline"
          >
            Open template
          </PluginLink>
        </Panel>
      )}
      <Panel
        title="Template content"
        description="Start with one locale. Add more versions after creating the template."
      >
        <form
          onSubmit={(event) => void submit(event)}
          className="grid min-w-0 gap-4 md:grid-cols-2"
        >
          <Field label="Name">
            <Input
              required
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
          </Field>
          <Field label="Slug">
            <Input
              required
              value={form.slug}
              onChange={(event) =>
                setForm({ ...form, slug: event.target.value })
              }
            />
          </Field>
          <Field label="Channel">
            <select
              className={fieldClass}
              value={form.channel}
              onChange={(event) =>
                setForm({ ...form, channel: event.target.value })
              }
            >
              {channels.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <select
              className={fieldClass}
              value={form.category}
              onChange={(event) =>
                setForm({ ...form, category: event.target.value })
              }
            >
              {["transactional", "auth", "marketing", "system"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </Field>
          <Field label="Locale">
            <Input
              required
              value={form.locale}
              onChange={(event) =>
                setForm({ ...form, locale: event.target.value })
              }
            />
          </Field>
          <Field label="Subject">
            <Input
              value={form.subject}
              onChange={(event) =>
                setForm({ ...form, subject: event.target.value })
              }
            />
          </Field>
          <Field label="Title">
            <Input
              value={form.title}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="Plain text">
              <Textarea
                value={form.text}
                onChange={(event) =>
                  setForm({ ...form, text: event.target.value })
                }
                rows={4}
              />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="HTML">
              <Textarea
                value={form.html}
                onChange={(event) =>
                  setForm({ ...form, html: event.target.value })
                }
                rows={5}
                className="font-mono text-xs"
              />
            </Field>
          </div>
          <Button
            type="submit"
            disabled={create.loading || !form.name.trim() || !form.slug.trim()}
            className="w-fit"
          >
            <Plus />
            Create template
          </Button>
        </form>
      </Panel>
    </section>
  )
}

function VersionEditor({
  templateId,
  version,
  onChanged,
}: {
  templateId: string
  version: Version
  onChanged: () => void
}) {
  const update = useCommand<Ack>("notification.versions.update")
  const remove = useCommand<Ack>("notification.versions.delete")
  const [draft, setDraft] = useState(version)
  const [confirm, setConfirm] = useState(false)
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (await update.execute({ ...draft, templateId })) onChanged()
  }
  async function deleteVersion() {
    if (await remove.execute({ id: version.id, templateId })) {
      setConfirm(false)
      onChanged()
    }
  }
  return (
    <form
      onSubmit={(event) => void save(event)}
      className="grid min-w-0 gap-3 md:grid-cols-2"
    >
      <CommandAlert
        title="Could not save version"
        error={update.error ?? remove.error}
      />
      <Field label="Locale">
        <Input value={draft.locale} readOnly />
      </Field>
      <Field label="Subject">
        <Input
          value={draft.subject ?? ""}
          onChange={(event) =>
            setDraft({ ...draft, subject: event.target.value })
          }
        />
      </Field>
      <Field label="Title">
        <Input
          value={draft.title ?? ""}
          onChange={(event) =>
            setDraft({ ...draft, title: event.target.value })
          }
        />
      </Field>
      <div className="flex items-center gap-2">
        <input
          id={`active-${version.id}`}
          type="checkbox"
          checked={draft.active}
          onChange={(event) =>
            setDraft({ ...draft, active: event.target.checked })
          }
        />
        <Label htmlFor={`active-${version.id}`}>Active</Label>
      </div>
      <div className="md:col-span-2">
        <Field label="Plain text">
          <Textarea
            rows={4}
            value={draft.text ?? ""}
            onChange={(event) =>
              setDraft({ ...draft, text: event.target.value })
            }
          />
        </Field>
      </div>
      <div className="md:col-span-2">
        <Field label="HTML">
          <Textarea
            rows={5}
            className="font-mono text-xs"
            value={draft.html ?? ""}
            onChange={(event) =>
              setDraft({ ...draft, html: event.target.value })
            }
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2 md:col-span-2">
        <Button type="submit" disabled={update.loading}>
          Save version
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={() => setConfirm(true)}
        >
          Delete version
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${version.locale} version?`}
        description="This version cannot be recovered."
        confirmLabel="Delete version"
        pending={remove.loading}
        onConfirm={() => void deleteVersion()}
      />
    </form>
  )
}

function PreviewPanel({ id, locale }: { id: string; locale: string }) {
  const query = useQuery<Preview>("notification.templates.preview", {
    id,
    locale,
    data: {},
  })
  return (
    <QueryBoundary title="Preview" query={query}>
      {(data) => (
        <div className="space-y-2 text-sm">
          <div className="font-medium">
            {data.subject || data.title || "No subject or title"}
          </div>
          <pre className="max-h-48 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
            {data.text || data.html || "No content"}
          </pre>
        </div>
      )}
    </QueryBoundary>
  )
}

export function NotificationDetailPage({ params }: PluginPageProps) {
  const id = params.id
  if (!id) return <p role="status">No template selected.</p>
  return <NotificationDetail id={id} />
}

function NotificationDetail({ id }: { id: string }) {
  const navigate = useNavigateTo()
  const [deleted, setDeleted] = useState(false)
  const query = useQuery<Template>("notification.templates.detail", { id })
  const update = useCommand<Ack>("notification.templates.update")
  const remove = useCommand<Ack>("notification.templates.delete")
  const addVersion = useCommand<Ack>("notification.versions.create")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [locale, setLocale] = useState("")
  const [subject, setSubject] = useState("")
  const [text, setText] = useState("")
  const [newVersionOpen, setNewVersionOpen] = useState(false)
  async function add(event: React.FormEvent) {
    event.preventDefault()
    if (await addVersion.execute({ templateId: id, locale, subject, text })) {
      setNewVersionOpen(false)
      setLocale("")
      setSubject("")
      setText("")
      query.refetch()
    }
  }
  if (deleted)
    return (
      <ZeroState
        title="Template deleted"
        action={<PageLink to="/notifications">Back to templates</PageLink>}
      />
    )
  return (
    <QueryBoundary title="Template" query={query}>
      {(item) => (
        <section className="flex min-w-0 flex-col gap-4">
          <PageHeader
            title={item.name}
            description={`${item.slug} · ${item.channel}`}
            actions={
              <div className="flex flex-wrap gap-2">
                <PageLink to="/notifications">Back</PageLink>
                <PageLink to="/notifications/send">Send</PageLink>
              </div>
            }
          />
          <CommandAlert
            title="Template action failed"
            error={update.error ?? remove.error ?? addVersion.error}
          />
          <Panel
            title="Template"
            description={item.is_system ? "System template" : "Custom template"}
          >
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Name">
                <Input
                  value={name ?? item.name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Badge variant={item.enabled ? "default" : "secondary"}>
                {item.enabled ? "Enabled" : "Disabled"}
              </Badge>
              <Button
                disabled={update.loading || !(name ?? item.name).trim()}
                onClick={async () => {
                  if (
                    await update.execute({
                      id,
                      name: name ?? item.name,
                      category: item.category,
                      enabled: item.enabled,
                    })
                  ) {
                    setName(null)
                    query.refetch()
                  }
                }}
              >
                Save
              </Button>
              <Button
                variant="outline"
                disabled={update.loading}
                onClick={async () => {
                  if (
                    await update.execute({
                      id,
                      name: name ?? item.name,
                      category: item.category,
                      enabled: !item.enabled,
                    })
                  )
                    query.refetch()
                }}
              >
                {item.enabled ? "Disable" : "Enable"}
              </Button>
              {!item.is_system && (
                <Button
                  variant="destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </Button>
              )}
            </div>
          </Panel>
          <Panel
            title="Locale versions"
            actions={
              <Button
                size="sm"
                variant="outline"
                onClick={() => setNewVersionOpen(!newVersionOpen)}
              >
                Add locale
              </Button>
            }
          >
            {newVersionOpen && (
              <form
                onSubmit={(event) => void add(event)}
                className="mb-4 grid gap-3 rounded-md border p-3 md:grid-cols-2"
              >
                <Field label="Locale">
                  <Input
                    required
                    value={locale}
                    onChange={(event) => setLocale(event.target.value)}
                  />
                </Field>
                <Field label="Subject">
                  <Input
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                  />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Plain text">
                    <Textarea
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                    />
                  </Field>
                </div>
                <Button
                  type="submit"
                  disabled={addVersion.loading || !locale.trim()}
                  className="w-fit"
                >
                  Create version
                </Button>
              </form>
            )}
            {(item.versions ?? []).length ? (
              <div className="space-y-4">
                {item.versions!.map((version) => (
                  <div key={version.id} className="rounded-md border p-3">
                    <VersionEditor
                      templateId={id}
                      version={version}
                      onChanged={() => query.refetch()}
                    />
                    <div className="mt-4 border-t pt-4">
                      <div className="mb-2 text-xs font-medium text-muted-foreground">
                        PREVIEW
                      </div>
                      <PreviewPanel id={id} locale={version.locale} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <ZeroState
                title="No locale versions"
                body="Add a locale to define the message content."
                illustration={<FileText className="size-6" />}
              />
            )}
          </Panel>
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title={`Delete ${item.name}?`}
            description="The template and its versions cannot be recovered."
            confirmLabel="Delete template"
            pending={remove.loading}
            onConfirm={async () => {
              if (await remove.execute({ id })) {
                setDeleted(true)
                setConfirmDelete(false)
                navigate("/notifications")
              }
            }}
          />
        </section>
      )}
    </QueryBoundary>
  )
}

export function NotificationSendPage() {
  const query = useQuery<TemplateList>("notification.templates.list")
  const send = useCommand<Ack>("notification.send")
  const [templateId, setTemplateId] = useState("")
  const [recipient, setRecipient] = useState("")
  const [locale, setLocale] = useState("")
  const [dataText, setDataText] = useState("{}")
  const [validation, setValidation] = useState("")
  const [confirm, setConfirm] = useState(false)
  const [sent, setSent] = useState(false)
  function parsedData(): Record<string, unknown> | null {
    try {
      const data: unknown = JSON.parse(dataText)
      if (data && typeof data === "object" && !Array.isArray(data))
        return data as Record<string, unknown>
    } catch {
      /* Display an editable validation error. */
    }
    setValidation("Variables must be a JSON object.")
    return null
  }
  async function execute(test: boolean) {
    const data = parsedData()
    if (!data || !templateId || !recipient.trim()) return
    setValidation("")
    const result = await send.execute({
      id: templateId,
      recipient: recipient.trim(),
      locale,
      data,
      test,
    })
    if (result) {
      setSent(true)
      setConfirm(false)
    }
  }
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Send notification"
        description="Choose a template and recipient, then review before sending."
        actions={<PageLink to="/notifications">Back to templates</PageLink>}
      />
      <CommandAlert title="Could not send notification" error={send.error} />
      {validation && (
        <p role="alert" className="text-sm text-destructive">
          {validation}
        </p>
      )}
      {sent && (
        <p role="status" className="text-sm text-emerald-600">
          Notification request accepted.
        </p>
      )}
      <QueryBoundary title="Templates" query={query}>
        {(data) => (
          <Panel title="Message">
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <Field label="Template">
                <select
                  className={fieldClass}
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                >
                  <option value="">Select a template</option>
                  {(data.templates ?? [])
                    .filter((item) => item.enabled)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.channel}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Recipient">
                <Input
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  placeholder="user@example.com or user ID"
                />
              </Field>
              <Field label="Locale">
                <Input
                  value={locale}
                  onChange={(event) => setLocale(event.target.value)}
                  placeholder="Default locale"
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="Variables (JSON)">
                  <Textarea
                    rows={5}
                    className="font-mono text-xs"
                    value={dataText}
                    onChange={(event) => setDataText(event.target.value)}
                  />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <Button
                  variant="outline"
                  disabled={send.loading || !templateId || !recipient.trim()}
                  onClick={() => void execute(true)}
                >
                  Test send
                </Button>
                <Button
                  disabled={send.loading || !templateId || !recipient.trim()}
                  onClick={() => {
                    if (parsedData()) {
                      setValidation("")
                      setConfirm(true)
                    }
                  }}
                >
                  <Send />
                  Send notification
                </Button>
              </div>
            </div>
          </Panel>
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Send notification?"
        description={`The selected template will be sent to ${recipient.trim()}.`}
        confirmLabel="Send notification"
        destructive={false}
        pending={send.loading}
        onConfirm={() => void execute(false)}
      />
    </section>
  )
}

const NotificationSettings = settingsPanelFor(
  "notification",
  "Notification settings"
)

export const notificationSubPlugin = defineSubPlugin({
  extension: "notification",
  host: "authsome",
  label: "Notification",
  nav: [
    {
      label: "Notifications",
      to: "/notifications",
      group: "Configuration",
      priority: 3,
      icon: <Bell />,
    },
  ],
  routes: [
    { path: "/notifications", element: NotificationsPage },
    { path: "/notifications/templates/new", element: NotificationCreatePage },
    { path: "/notifications/templates/:id", element: NotificationDetailPage },
    { path: "/notifications/send", element: NotificationSendPage },
    { path: "/notifications/settings", element: NotificationSettings },
  ],
  hostIntents: [...SETTINGS_INTENTS],
  contributions: {
    "settings.tabs": [
      {
        id: "notification",
        label: "Notifications",
        render: NotificationSettings,
      },
    ],
  },
})
