import { useEffect, useId, useRef, useState } from "react"
import type { FormEvent, InputHTMLAttributes } from "react"
import { Link, Navigate } from "react-router"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { AuthConfig, SetupStatus } from "@forge-go/dashboard-plugin"
import { AuthLayout } from "@forge-go/dashboard-kit/components/auth-layout"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Spinner } from "@forge-go/dashboard-kit/components/spinner"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import type { AuthScreenProps } from "../routes"
import { currentServerHost } from "../server-host"
import { MetadataEditor } from "./setup-metadata"
import {
  buildCompleteSetupInput,
  createSetupDraft,
  updateSetupName,
  validateSetupStep,
} from "./setup-model"
import type { SetupDraft, SetupFieldErrors, SetupStep } from "./setup-model"

const steps: SetupStep[] = ["platform", "environment", "administrator"]
const stepLabels = {
  platform: "Platform",
  environment: "Environment",
  administrator: "Administrator",
}

export function SetupScreen(props: AuthScreenProps) {
  const config = useQuery<AuthConfig>(props.intents.config)
  const status = useQuery<SetupStatus>(props.intents.setupStatus ?? "")

  if (status.loading && !status.data) {
    return (
      <AuthLayout title="Preparing setup" serverHost={currentServerHost()}>
        <Spinner />
      </AuthLayout>
    )
  }
  if (status.error || !status.data) {
    return (
      <AuthLayout
        title="Setup status unavailable"
        serverHost={currentServerHost()}
      >
        <CommandAlert
          error={status.error}
          showCode={false}
          title="Connection failed"
        />
        <Button variant="outline" onClick={() => status.refetch()}>
          Retry
        </Button>
      </AuthLayout>
    )
  }
  if (!status.data.pending) {
    return (
      <Navigate replace to={`/login?next=${encodeURIComponent(props.next)}`} />
    )
  }
  const wizard = Boolean(status.data.platform || status.data.environment)
  return (
    <SetupForm
      key={wizard ? "platform" : "minimal"}
      {...props}
      brand={config.data?.brand}
      status={status.data}
      wizard={wizard}
    />
  )
}

function SetupForm({
  intents,
  onAuthenticated,
  next,
  brand,
  status,
  wizard,
}: AuthScreenProps & { brand?: string; status: SetupStatus; wizard: boolean }) {
  const complete = useCommand<{ ok: boolean }>(intents.completeSetup ?? "")
  const [draft, setDraft] = useState(() => createSetupDraft(status))
  const [step, setStep] = useState<SetupStep>(
    wizard ? "platform" : "administrator"
  )
  const [errors, setErrors] = useState<SetupFieldErrors>({})
  const [failedLogo, setFailedLogo] = useState<string>()
  const formRef = useRef<HTMLFormElement>(null)
  const prefix = useId()
  const loginTarget = `/login?next=${encodeURIComponent(next)}`

  useEffect(() => {
    const firstError = Object.keys(errors)[0]
    if (!firstError) return
    const target = formRef.current?.elements.namedItem(firstError)
    if (target instanceof HTMLElement) target.focus()
  }, [errors])

  function changeStep(value: SetupStep) {
    setErrors({})
    setStep(value)
  }
  function updateSection(
    section: "platform" | "environment",
    patch: Partial<SetupDraft["platform"]> | Partial<SetupDraft["environment"]>
  ) {
    setDraft((current) => ({
      ...current,
      [section]: { ...current[section], ...patch },
    }))
  }
  function updateAdministrator(
    key: keyof SetupDraft["administrator"],
    value: string
  ) {
    setDraft((current) => ({
      ...current,
      administrator: { ...current.administrator, [key]: value },
    }))
  }
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (complete.loading) return
    const checked = wizard
      ? draft
      : {
          ...draft,
          administrator: {
            ...draft.administrator,
            confirmPassword: draft.administrator.password,
          },
        }
    const fieldErrors = validateSetupStep(checked, step)
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length) {
      return
    }
    if (step !== "administrator") {
      changeStep(step === "platform" ? "environment" : "administrator")
      return
    }
    const input = wizard
      ? buildCompleteSetupInput(draft)
      : {
          email: draft.administrator.email.trim(),
          password: draft.administrator.password,
        }
    const result = await complete.execute(input)
    if (result?.ok) onAuthenticated()
  }
  function field(
    path: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    inputProps: InputHTMLAttributes<HTMLInputElement> = {}
  ) {
    const id = `${prefix}-${path}`
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor={id}>{label}</Label>
        <Input
          {...inputProps}
          id={id}
          name={path}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(errors[path])}
          aria-describedby={errors[path] ? `${id}-error` : undefined}
        />
        {errors[path] ? (
          <p id={`${id}-error`} className="text-xs text-destructive">
            {errors[path]}
          </p>
        ) : null}
      </div>
    )
  }

  // This response means another request completed the one-time setup first.
  if (
    complete.error?.code === "PERMISSION_DENIED" &&
    /setup.*already.*complet/i.test(complete.error.message)
  ) {
    return (
      <AuthLayout
        brand={brand}
        title="Setup already completed"
        serverHost={currentServerHost()}
      >
        <Link className="text-sm underline" to={loginTarget}>
          Continue to sign in
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      brand={brand}
      title={wizard ? "Set up your platform" : "Create the first administrator"}
      description={
        wizard
          ? "Configure your platform, environment and administrator."
          : "This account owns the server until it grants access to others."
      }
      serverHost={currentServerHost()}
      size={wizard ? "wide" : "default"}
      density="compact"
    >
      {wizard ? (
        <ol
          aria-label="Setup progress"
          className="mb-5 flex flex-wrap gap-x-6 gap-y-2 text-sm"
        >
          {steps.map((item, index) => (
            <li key={item}>
              <span
                aria-current={step === item ? "step" : undefined}
                className={
                  step === item
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                }
              >
                {index + 1}. {stepLabels[item]}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <CommandAlert
        error={complete.error}
        showCode={false}
        title="Setup failed"
      />
      <form
        ref={formRef}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit}
      >
        <fieldset disabled={complete.loading} className="min-w-0 space-y-3">
          {step === "platform" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {field(
                  "platform.name",
                  "Platform name",
                  draft.platform.name,
                  (value) =>
                    setDraft((current) =>
                      updateSetupName(current, "platform", value)
                    )
                )}
                {field(
                  "platform.slug",
                  "Platform slug",
                  draft.platform.slug,
                  (value) =>
                    updateSection("platform", {
                      slug: value,
                      slugTouched: true,
                    })
                )}
              </div>
              <div className="flex items-end gap-3">
                <div className="min-w-0 flex-1">
                  {field(
                    "platform.logo",
                    "Logo URL",
                    draft.platform.logo ?? "",
                    (value) => updateSection("platform", { logo: value })
                  )}
                </div>
                {draft.platform.logo && failedLogo !== draft.platform.logo ? (
                  <img
                    className="size-9 shrink-0 rounded-md border object-contain"
                    alt="Platform logo preview"
                    src={draft.platform.logo}
                    onError={() => setFailedLogo(draft.platform.logo)}
                  />
                ) : (
                  <span
                    data-testid="platform-logo-fallback"
                    className="flex size-9 shrink-0 items-center justify-center rounded-md border text-sm"
                    aria-label="Platform initials"
                  >
                    {draft.platform.name.charAt(0).toUpperCase() || "F"}
                  </span>
                )}
              </div>
              <details
                className="text-sm"
                open={
                  Object.keys(errors).some((key) =>
                    key.startsWith("platform.metadata")
                  ) || undefined
                }
              >
                <summary className="cursor-pointer text-muted-foreground">
                  Platform metadata
                </summary>
                <div className="pt-2">
                  <MetadataEditor
                    rows={draft.platform.metadata}
                    onChange={(metadata) =>
                      updateSection("platform", { metadata })
                    }
                    path="platform.metadata"
                    idPrefix={`${prefix}-platform`}
                    errors={errors}
                    disabled={complete.loading}
                  />
                </div>
              </details>
            </>
          ) : null}
          {step === "environment" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {field(
                  "environment.name",
                  "Environment name",
                  draft.environment.name,
                  (value) =>
                    setDraft((current) =>
                      updateSetupName(current, "environment", value)
                    )
                )}
                {field(
                  "environment.slug",
                  "Environment slug",
                  draft.environment.slug,
                  (value) =>
                    updateSection("environment", {
                      slug: value,
                      slugTouched: true,
                    })
                )}
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${prefix}-type`}>Environment type</Label>
                  <select
                    id={`${prefix}-type`}
                    name="environment.type"
                    className="h-9 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={draft.environment.type}
                    onChange={(event) =>
                      updateSection("environment", {
                        type: event.target
                          .value as SetupDraft["environment"]["type"],
                      })
                    }
                  >
                    <option value="development">Development</option>
                    <option value="staging">Staging</option>
                    <option value="production">Production</option>
                  </select>
                </div>
                {field(
                  "environment.color",
                  "Color",
                  draft.environment.color ?? "#2563eb",
                  (value) => updateSection("environment", { color: value }),
                  { type: "color" }
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${prefix}-description`}>Description</Label>
                <Textarea
                  id={`${prefix}-description`}
                  name="environment.description"
                  rows={2}
                  value={draft.environment.description ?? ""}
                  onChange={(event) =>
                    updateSection("environment", {
                      description: event.target.value,
                    })
                  }
                  aria-invalid={Boolean(errors["environment.description"])}
                  aria-describedby={
                    errors["environment.description"]
                      ? `${prefix}-description-error`
                      : undefined
                  }
                />
                {errors["environment.description"] ? (
                  <p
                    id={`${prefix}-description-error`}
                    className="text-xs text-destructive"
                  >
                    {errors["environment.description"]}
                  </p>
                ) : null}
              </div>
              <details
                className="text-sm"
                open={
                  Object.keys(errors).some((key) =>
                    key.startsWith("environment.metadata")
                  ) || undefined
                }
              >
                <summary className="cursor-pointer text-muted-foreground">
                  Environment metadata
                </summary>
                <div className="pt-2">
                  <MetadataEditor
                    rows={draft.environment.metadata}
                    onChange={(metadata) =>
                      updateSection("environment", { metadata })
                    }
                    path="environment.metadata"
                    idPrefix={`${prefix}-environment`}
                    errors={errors}
                    disabled={complete.loading}
                  />
                </div>
              </details>
            </>
          ) : null}
          {step === "administrator" ? (
            <>
              {wizard ? (
                <div className="mb-4 divide-y rounded-md border px-3 text-sm">
                  {(["platform", "environment"] as const).map((section) => (
                    <div
                      key={section}
                      className="flex min-w-0 items-center justify-between gap-2 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">
                          {stepLabels[section]}
                        </p>
                        <p className="break-words">
                          {draft[section].name}{" "}
                          <span className="text-muted-foreground">
                            ({draft[section].slug})
                          </span>
                        </p>
                      </div>
                      <IconButton
                        label={`Edit ${section}`}
                        onClick={() => changeStep(section)}
                        disabled={complete.loading}
                        type="button"
                      />
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                {wizard
                  ? field(
                      "administrator.name",
                      "Your name",
                      draft.administrator.name,
                      (value) => updateAdministrator("name", value),
                      { autoComplete: "name" }
                    )
                  : null}
                {field(
                  "administrator.email",
                  "Email",
                  draft.administrator.email,
                  (value) => updateAdministrator("email", value),
                  { type: "email", autoComplete: "username" }
                )}
                {field(
                  "administrator.password",
                  "Password",
                  draft.administrator.password,
                  (value) => updateAdministrator("password", value),
                  { type: "password", autoComplete: "new-password" }
                )}
                {wizard
                  ? field(
                      "administrator.confirmPassword",
                      "Confirm password",
                      draft.administrator.confirmPassword,
                      (value) => updateAdministrator("confirmPassword", value),
                      { type: "password", autoComplete: "new-password" }
                    )
                  : null}
              </div>
            </>
          ) : null}
        </fieldset>
        <div className="flex items-center justify-end gap-2 border-t pt-3">
          {wizard && step !== "platform" ? (
            <IconButton
              label="Back"
              disabled={complete.loading}
              onClick={() =>
                changeStep(
                  step === "administrator" ? "environment" : "platform"
                )
              }
              type="button"
            />
          ) : null}
          <Button disabled={complete.loading} type="submit">
            {complete.loading
              ? "Creating…"
              : step === "platform"
                ? "Continue to environment"
                : step === "environment"
                  ? "Continue to administrator"
                  : wizard
                    ? "Create platform"
                    : "Create and continue"}
          </Button>
        </div>
      </form>
    </AuthLayout>
  )
}
