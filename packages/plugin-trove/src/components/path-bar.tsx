import { Fragment, useState } from "react"
import type { FormEvent } from "react"
import { PluginLink, useNavigateTo } from "@forge-go/dashboard-plugin"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { browserHref, folderOf } from "../browser-location"

/**
 * The current prefix as the literal key: each folder segment a link back up,
 * the rest an input that continues the prefix on Enter. It never draws a
 * tree. The parent keys this by prefix, so the draft resets on navigation.
 */
export function PathBar({ bucket, store, prefix }: { bucket: string; store: string; prefix: string }) {
  const navigate = useNavigateTo()
  const folder = folderOf(prefix)
  const segments = folder === "" ? [] : folder.slice(0, -1).split("/")
  const [draft, setDraft] = useState(prefix.slice(folder.length))

  function submit(event: FormEvent) {
    event.preventDefault()
    navigate(browserHref(bucket, { store, prefix: folder + draft }))
  }

  return (
    <form aria-label="Prefix" onSubmit={submit} className="flex flex-wrap items-center gap-1 font-mono text-xs">
      <PluginLink to={browserHref(bucket, { store })} className="font-medium hover:underline">
        {bucket}
      </PluginLink>
      <span aria-hidden="true" className="text-muted-foreground">/</span>
      {segments.map((segment, i) => {
        const to = `${segments.slice(0, i + 1).join("/")}/`
        return (
          <Fragment key={to}>
            <PluginLink to={browserHref(bucket, { store, prefix: to })} className="hover:underline">
              {segment === "" ? <span className="text-muted-foreground">(empty)</span> : segment}
            </PluginLink>
            <span aria-hidden="true" className="text-muted-foreground">/</span>
          </Fragment>
        )
      })}
      <Input
        aria-label="Continue the prefix"
        placeholder="filter this prefix, then Enter"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="h-7 w-64 font-mono text-xs"
      />
    </form>
  )
}
