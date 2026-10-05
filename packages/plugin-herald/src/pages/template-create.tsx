import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { PluginLink, useCommand, useNavigateTo } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { CATEGORIES } from "../format"
import { templatePath, templatesPath } from "../keys"
import type { EngineInfoResponse, TemplateResponse, TemplatesCreateRequest } from "../wire"

/** The server's own patterns, so a refusal shows before the round trip. */
const SLUG = /^[a-z0-9][a-z0-9._-]{0,127}$/
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

function CreateForm({ engine }: { engine: EngineInfoResponse }) {
  const create = useCommand<TemplateResponse>("templates.create")
  const navigateTo = useNavigateTo()
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [channel, setChannel] = useState("")
  const [category, setCategory] = useState("transactional")
  const [locale, setLocale] = useState("")
  const [sent, setSent] = useState<{ slug: string; channel: string } | null>(null)

  const slugValue = slug.trim()
  const localeValue = locale.trim()
  const slugBad = slugValue !== "" && !SLUG.test(slugValue)
  const localeBad = localeValue !== "" && !LOCALE.test(localeValue)
  const canSubmit = !create.loading && name.trim() !== "" && slugValue !== "" && !slugBad && channel !== "" && !localeBad

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    const payload: TemplatesCreateRequest = { slug: slugValue, name: name.trim(), channel, category, version: { locale: localeValue } }
    setSent({ slug: slugValue, channel })
    const result = await create.execute(payload)
    if (result === undefined) return
    navigateTo(templatePath(result.template.id))
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex max-w-xl flex-col gap-4">
      <CommandAlert
        title="Could not create the template"
        error={
          sent !== null && create.error?.code === "CONFLICT"
            ? { code: create.error.code, message: `A template with the slug ${sent.slug} already exists on ${sent.channel}. Slugs are unique per channel; open the existing one, or pick another slug.` }
            : create.error
        }
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-name">Name</Label>
        <Input id="template-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-slug">Slug</Label>
        <Input id="template-slug" className="font-mono" autoComplete="off" spellCheck={false} value={slug} aria-invalid={slugBad || undefined} onChange={(e) => setSlug(e.target.value)} />
        <p className={slugBad ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          What callers send to pick this template. Use lower-case letters, digits, dots, dashes or underscores. It can't change later.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="template-channel">Channel</Label>
          <NativeSelect id="template-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <NativeSelectOption value="">Choose a channel</NativeSelectOption>
            {engine.channels.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {c}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="template-category">Category</Label>
          <NativeSelect id="template-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {c}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-locale">First version's locale</Label>
        <Input id="template-locale" className="font-mono" placeholder={engine.defaultLocale} autoComplete="off" spellCheck={false} value={locale} aria-invalid={localeBad || undefined} onChange={(e) => setLocale(e.target.value)} />
        <p className={localeBad ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          Empty starts with the fallback version, which answers any locale the template doesn't list. A tag like en or pt-BR starts with that translation instead.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSubmit}>
          {create.loading ? "Creating…" : "Create template"}
        </Button>
        <PluginLink to={templatesPath} className="text-sm underline">
          Cancel
        </PluginLink>
      </div>
    </form>
  )
}

export const TemplateCreatePage: ComponentType<PluginPageProps> = () => {
  const info = useEngineInfo()
  return (
    <section className="flex flex-col gap-4">
      <HeraldHeader title="New template" description="Its content, variables and other locales are edited in the template workspace once it exists." />
      <QueryBoundary title="Channels" query={info} skeletonRows={3}>
        {(engine) => <CreateForm engine={engine} />}
      </QueryBoundary>
    </section>
  )
}
