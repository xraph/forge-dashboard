import { useState } from "react"
import type { ComponentType, FormEvent, ReactNode } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps, QueryState } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import {
  DiagnosticsList,
  RenderedPreview,
} from "../components/preview/rendered-preview"
import { useRenderPreview } from "../components/preview/use-render-preview"
import {
  ProviderLabel,
  ResolvedProvider,
} from "../components/resolved-provider"
import { NO_RECEIPTS, statusLabel } from "../format"
import { messagePath } from "../keys"
import { useDebounced } from "../use-debounced"
import type {
  EngineInfoResponse,
  MessagesDetailResponse,
  ProvidersDetailResponse,
  ProvidersListResponse,
  SendResolveResponse,
  SendTestRequest,
  SendTestResponse,
  TemplatesDetailResponse,
  TemplatesListResponse,
  TemplatesResolveResponse,
} from "../wire"

interface Initial {
  channel: string
  providerId: string
  recipient: string
  templateSlug: string
}

const EMPTY: Initial = {
  channel: "",
  providerId: "",
  recipient: "",
  templateSlug: "",
}

/** What the confirm said it would do, taken when it opened, so the result is read against it however the page refetches. */
interface Snapshot {
  channel: string
  recipient: string
  /** Who send.resolve said would send it. */
  providerId: string
  provider: string
  driver: string
  disabled: boolean
  templateSlug: string
  userId: string
}

const NO_SNAPSHOT: Snapshot = {
  channel: "",
  recipient: "",
  providerId: "",
  provider: "",
  driver: "",
  disabled: false,
  templateSlug: "",
  userId: "",
}

function describeTarget(s: Snapshot): string {
  return `${s.provider}${s.driver ? ` (${s.driver})` : ""}${s.disabled ? ", which is disabled" : ""}`
}

function ResultCard({ r, sent }: { r: SendTestResponse; sent: Snapshot }) {
  const who = r.provider ? (
    <ProviderLabel id={r.provider.id} name={r.provider.name} />
  ) : null
  const rerouted =
    r.provider !== null &&
    sent.providerId !== "" &&
    r.provider.id !== sent.providerId
  return (
    <section
      aria-labelledby="send-result"
      className="flex min-w-0 flex-col gap-2 rounded-lg border p-4 text-sm"
    >
      <h2 id="send-result" className="font-medium">
        Result
      </h2>
      {rerouted && r.provider && (
        <p>
          Herald sent it through {who}
          {r.provider.driver ? ` (${r.provider.driver})` : ""}, not{" "}
          <ProviderLabel
            id={sent.providerId}
            name={sent.provider === sent.providerId ? "" : sent.provider}
          />{" "}
          as the confirm said. Routing changed between the check and the send.
        </p>
      )}
      {r.status === "sent" && (
        <p>
          Accepted by {who ?? "the provider"}
          {r.providerMessageId && (
            <>
              {" "}
              (<span className="font-mono text-xs">{r.providerMessageId}</span>)
            </>
          )}
          . {NO_RECEIPTS}
        </p>
      )}
      {r.status === "failed" && (
        <>
          <p>It failed{who && <> ({who})</>}. The error Herald recorded:</p>
          <pre className="overflow-x-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">
            {r.error || "(no error text)"}
          </pre>
        </>
      )}
      {r.status === "suppressed" && (
        <>
          <p>
            Not sent:{" "}
            {sent.userId ? (
              <span className="font-mono text-xs">{sent.userId}</span>
            ) : (
              "the user"
            )}{" "}
            opted out of{" "}
            {sent.templateSlug ? (
              <span className="font-mono text-xs">{sent.templateSlug}</span>
            ) : (
              "this template"
            )}{" "}
            on {sent.channel}.
          </p>
          {r.error && (
            <p className="text-muted-foreground">Herald's reason: {r.error}</p>
          )}
        </>
      )}
      {r.status === "sending" && (
        <p>Handed to {who ?? "the provider"}, and not settled yet.</p>
      )}
      {r.status !== "sent" &&
        r.status !== "failed" &&
        r.status !== "suppressed" &&
        r.status !== "sending" && (
          <p>Herald recorded it as {statusLabel(r.status)}.</p>
        )}
      {!r.logged && (
        <p>
          The message log couldn't be written, so this send won't appear under
          Messages.
        </p>
      )}
      {r.messageId && r.logged && (
        <p>
          <PluginLink to={messagePath(r.messageId)} className="underline">
            Open it under Messages
          </PluginLink>
        </p>
      )}
    </section>
  )
}

function SendForm({
  engine,
  initial,
}: {
  engine: EngineInfoResponse
  initial: Initial
}) {
  const send = useCommand<SendTestResponse>("send.test")
  const [channel, setChannel] = useState(initial.channel)
  const [providerId, setProviderId] = useState(initial.providerId)
  const [recipient, setRecipient] = useState(initial.recipient)
  const [mode, setMode] = useState<"template" | "raw">("template")
  // null: not chosen yet, so a message's template (if any) is the default.
  const [templateChoice, setTemplateChoice] = useState<string | null>(null)
  const [locale, setLocale] = useState(engine.defaultLocale)
  const [data, setData] = useState<Record<string, string>>({})
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [userId, setUserId] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot>(NO_SNAPSHOT)

  const user = userId.trim()
  const settledUser = useDebounced(user, 300)

  const providers = useQuery<ProvidersListResponse>(
    "providers.list",
    { channel },
    { enabled: channel !== "" }
  )
  const templates = useQuery<TemplatesListResponse>(
    "templates.list",
    { channel },
    { enabled: channel !== "" && mode === "template" }
  )
  const templateId =
    templateChoice ??
    templates.data?.templates.find((t) => t.slug === initial.templateSlug)
      ?.id ??
    ""
  const detail = useQuery<TemplatesDetailResponse>(
    "templates.detail",
    { id: templateId },
    { enabled: mode === "template" && templateId !== "" }
  )
  const resolved = useQuery<TemplatesResolveResponse>(
    "templates.resolve",
    { id: templateId, locale: locale.trim() },
    { enabled: mode === "template" && templateId !== "" }
  )

  const resolveParams: Record<string, unknown> = { channel }
  if (providerId) resolveParams.providerId = providerId
  if (settledUser) resolveParams.userId = settledUser
  const who = useQuery<SendResolveResponse>("send.resolve", resolveParams, {
    enabled: channel !== "",
  })

  const template = detail.data?.template
  const version = template?.versions.find(
    (v) => v.id === resolved.data?.versionId
  )
  // Only the variables this template declares, so a value typed for another template never rides along.
  const sample: Record<string, string> = {}
  for (const v of template?.variables ?? []) {
    const value = data[v.name]
    if (value !== undefined && value.trim() !== "") sample[v.name] = value
  }
  const preview = useRenderPreview(
    mode === "template" && template && version
      ? {
          templateId: template.id,
          content: {
            subject: version.subject,
            html: version.html,
            text: version.text,
            title: version.title,
          },
          data: sample,
        }
      : null
  )

  // Send is offered only when send.resolve has answered for what is on screen now and named a provider.
  const target = who.data?.provider ?? null
  const answered =
    who.data !== undefined && !who.error && !who.loading && settledUser === user
  const ready =
    mode === "template" ? template !== undefined : body.trim() !== ""
  const canSend =
    !send.loading &&
    channel !== "" &&
    recipient.trim() !== "" &&
    ready &&
    answered &&
    target !== null

  function pickChannel(next: string) {
    setChannel(next)
    setProviderId("")
    setTemplateChoice("")
    setData({})
  }

  function openConfirm(event: FormEvent) {
    event.preventDefault()
    if (!canSend || target === null) return
    send.reset()
    setSnapshot({
      channel,
      recipient: recipient.trim(),
      providerId: target.id,
      provider: target.name || target.id,
      driver: target.driver ?? "",
      disabled: target.enabled === false,
      templateSlug: mode === "template" && template ? template.slug : "",
      userId: user,
    })
    setConfirming(true)
  }

  async function confirm() {
    const payload: SendTestRequest = {
      channel: snapshot.channel,
      recipient: snapshot.recipient,
    }
    if (providerId) payload.providerId = providerId
    if (mode === "template" && template) {
      payload.template = template.slug
      if (locale.trim()) payload.locale = locale.trim()
      if (Object.keys(sample).length > 0) payload.data = sample
    } else {
      payload.body = body
      if (subject.trim() && channel !== "sms") payload.subject = subject.trim()
    }
    if (snapshot.userId) payload.userId = snapshot.userId
    const result = await send.execute(payload)
    // A provider failure is a normal answer with status "failed"; only a
    // refusal before any provider saw it lands here as undefined, and that
    // stays in the dialog.
    if (result === undefined) return
    setConfirming(false)
  }

  return (
    <div className="grid min-w-0 gap-4 @3xl/main:grid-cols-2">
      <form onSubmit={openConfirm} className="flex min-w-0 flex-col gap-4">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="send-channel">Channel</Label>
            <NativeSelect
              id="send-channel"
              value={channel}
              onChange={(e) => pickChannel(e.target.value)}
            >
              <NativeSelectOption value="">Choose a channel</NativeSelectOption>
              {engine.channels.map((c) => (
                <NativeSelectOption key={c} value={c}>
                  {c}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="send-provider">Provider</Label>
            <NativeSelect
              id="send-provider"
              value={providerId}
              disabled={channel === ""}
              onChange={(e) => setProviderId(e.target.value)}
            >
              <NativeSelectOption value="">
                Let Herald choose
              </NativeSelectOption>
              {(providers.data?.providers ?? []).map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>

        {channel !== "" && (
          <div className="text-sm">
            {who.error ? (
              <p className="text-destructive">
                Couldn't ask who would send: {who.error.code}:{" "}
                {who.error.message}. Send is held until that answers.
              </p>
            ) : !who.data || settledUser !== user ? (
              <p className="text-muted-foreground">Asking who would send…</p>
            ) : (
              <ResolvedProvider
                answer={who.data}
                channel={channel}
                lead="Sends through"
              />
            )}
          </div>
        )}

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="send-recipient">Recipient</Label>
          <Input
            id="send-recipient"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="send-user">User ID (optional)</Label>
          <Input
            id="send-user"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Set it to test the user's opt-outs and routing rule, and in-app
            delivery.
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="send-mode">Content</Label>
          <NativeSelect
            id="send-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as "template" | "raw")}
          >
            <NativeSelectOption value="template">A template</NativeSelectOption>
            <NativeSelectOption value="raw">Write it here</NativeSelectOption>
          </NativeSelect>
        </div>

        {mode === "template" ? (
          <>
            <div className="grid min-w-0 gap-3 sm:grid-cols-[2fr_1fr]">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="send-template">Template</Label>
                <NativeSelect
                  id="send-template"
                  value={templateId}
                  disabled={channel === ""}
                  onChange={(e) => setTemplateChoice(e.target.value)}
                >
                  <NativeSelectOption value="">
                    {channel === ""
                      ? "Choose a channel first"
                      : "Choose a template"}
                  </NativeSelectOption>
                  {(templates.data?.templates ?? []).map((t) => (
                    <NativeSelectOption key={t.id} value={t.id}>
                      {`${t.name} (${t.slug})`}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="send-locale">Locale</Label>
                <Input
                  id="send-locale"
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  value={locale}
                  onChange={(e) => setLocale(e.target.value)}
                />
              </div>
            </div>
            {templateId !== "" &&
              resolved.data &&
              resolved.data.versionId === null && (
                <p className="text-sm">
                  No version answers {locale.trim() || "the fallback"}, so this
                  send would fail. Add a fallback version, or pick a locale the
                  template has.
                </p>
              )}
            {template && template.variables.length > 0 && (
              <fieldset className="flex min-w-0 flex-col gap-3">
                <legend className="mb-1 text-sm font-medium">Variables</legend>
                {template.variables.map((v) => (
                  <div key={v.name} className="flex min-w-0 flex-col gap-1.5">
                    <Label
                      htmlFor={`var-${v.name}`}
                      className="font-mono text-xs"
                    >
                      {v.name}
                    </Label>
                    <Input
                      id={`var-${v.name}`}
                      placeholder={v.default ?? ""}
                      autoComplete="off"
                      value={data[v.name] ?? ""}
                      onChange={(e) =>
                        setData((d) => ({ ...d, [v.name]: e.target.value }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {v.type}
                      {v.required ? ", required" : ""}
                      {v.default ? `, defaults to ${v.default}` : ""}
                      {v.description ? `. ${v.description}` : ""}
                    </p>
                  </div>
                ))}
              </fieldset>
            )}
          </>
        ) : (
          <>
            {channel !== "sms" && (
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="send-subject">Subject</Label>
                <Input
                  id="send-subject"
                  autoComplete="off"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="send-body">Body</Label>
              <Textarea
                id="send-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          </>
        )}

        <div>
          <Button type="submit" disabled={!canSend}>
            Send test
          </Button>
        </div>
        {/* Mounted before the send, so the result is announced when it arrives. */}
        <div aria-live="polite" className="empty:sr-only">
          {send.data && <ResultCard r={send.data} sent={snapshot} />}
        </div>
      </form>

      {mode === "template" && template && (
        <section
          aria-labelledby="send-preview"
          className="flex min-w-0 flex-col gap-3"
        >
          <h2 id="send-preview" className="text-sm font-medium">
            Preview
          </h2>
          {preview.error && (
            <p className="text-sm text-destructive">
              {preview.error.code}: {preview.error.message}
            </p>
          )}
          <DiagnosticsList diagnostics={preview.result?.diagnostics ?? []} />
          <RenderedPreview
            channel={channel}
            result={preview.result}
            from={who.data?.from}
            stale={preview.stale}
          />
        </section>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => !open && !send.loading && setConfirming(false)}
        title="Send a real test message?"
        description={`This sends a real ${snapshot.channel} message to ${snapshot.recipient} through ${describeTarget(snapshot)}. It is logged like any other send.`}
        confirmLabel="Send"
        destructive={false}
        pending={send.loading}
        onConfirm={() => void confirm()}
      >
        <CommandAlert error={send.error} title="Herald refused the send" />
      </ConfirmDialog>
    </div>
  )
}

/**
 * Prefills the form from a read, once. The form is rendered outside the read's
 * boundary on purpose: send.test invalidates messages.detail, so a form held
 * inside that boundary would unmount on the refetch the send itself causes and
 * take the result card with it. After the first answer the read can reload or
 * fail and the form, its confirm and its result stay where they are.
 */
function Prefilled<T>({
  title,
  query,
  derive,
  children,
}: {
  title: string
  query: QueryState<T>
  derive: (data: T) => Initial
  children: (initial: Initial) => ReactNode
}) {
  const [initial, setInitial] = useState<Initial | null>(null)
  if (initial === null && query.data !== undefined)
    setInitial(derive(query.data))
  if (initial !== null) return <>{children(initial)}</>
  return (
    <QueryBoundary title={title} query={query} skeletonRows={2}>
      {() => null}
    </QueryBoundary>
  )
}

function Pinned({
  engine,
  providerId,
}: {
  engine: EngineInfoResponse
  providerId: string
}) {
  const pinned = useQuery<ProvidersDetailResponse>("providers.detail", {
    id: providerId,
  })
  return (
    <Prefilled
      title="Provider"
      query={pinned}
      derive={({ provider }) => ({
        ...EMPTY,
        channel: provider.channel,
        providerId: provider.id,
      })}
    >
      {(initial) => <SendForm engine={engine} initial={initial} />}
    </Prefilled>
  )
}

function FromMessage({
  engine,
  messageId,
}: {
  engine: EngineInfoResponse
  messageId: string
}) {
  const message = useQuery<MessagesDetailResponse>("messages.detail", {
    id: messageId,
  })
  return (
    <Prefilled
      title="Message"
      query={message}
      derive={({ message: m }) => ({
        ...EMPTY,
        channel: m.channel,
        recipient: m.recipient,
        templateSlug: m.template?.slug ?? "",
      })}
    >
      {(initial) => <SendForm engine={engine} initial={initial} />}
    </Prefilled>
  )
}

/**
 * One page for three routes: plain, pinned to a provider (from its detail
 * page) and prefilled from a message (from its detail page, in place of the
 * templ dashboard's Retry, which re-sent a truncated text body as if it were
 * the original).
 */
export const SendTestPage: ComponentType<PluginPageProps> = ({ params }) => {
  const info = useEngineInfo()
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <HeraldHeader
        title="Send test"
        description="Sends a real message to a real recipient, and logs it like any other send."
      />
      <QueryBoundary title="Channels" query={info} skeletonRows={4}>
        {(engine) =>
          params.providerId ? (
            <Pinned
              key={params.providerId}
              engine={engine}
              providerId={params.providerId}
            />
          ) : params.messageId ? (
            <FromMessage
              key={params.messageId}
              engine={engine}
              messageId={params.messageId}
            />
          ) : (
            <SendForm engine={engine} initial={EMPTY} />
          )
        }
      </QueryBoundary>
    </section>
  )
}
