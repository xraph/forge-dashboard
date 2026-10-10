import type { ReactNode } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { DisabledProviderBadge } from "../badges"
import { providerPath } from "../keys"
import type { ResolveVia, SendResolveResponse } from "../wire"

/** Why send.resolve picked what it picked, each a sentence of its own. */
export const VIA_TEXT: Record<ResolveVia, string> = {
  user: "The user's routing rule names it.",
  org: "The org's routing rule names it.",
  app: "The app's routing rule names it.",
  fallback:
    "No rule names one, so Herald takes the first enabled provider for the channel by priority.",
  chosen: "It was chosen explicitly.",
  none: "No provider would send it.",
}

/** The provider's name, or its ID as an identifier when it has no name. */
export function ProviderLabel({ id, name }: { id: string; name: string }) {
  return name ? <>{name}</> : <span className="font-mono text-xs">{id}</span>
}

/**
 * What send.resolve answered, in one wording for every page that asks it: who
 * would send (or that nobody would), the driver, a disabled flag, and why.
 * `lead` opens the first line ("Sends through"), `link` makes the name a link
 * to the provider's page, and `from` adds the sender line.
 */
export function ResolvedProvider({
  answer,
  channel,
  lead,
  link = false,
  from = false,
}: {
  answer: SendResolveResponse
  channel: string
  lead?: ReactNode
  link?: boolean
  from?: boolean
}) {
  const { provider } = answer
  if (provider === null) {
    return (
      <p className="text-sm">
        Nothing would send it: no rule names a usable provider for {channel},
        and no enabled provider handles it.
      </p>
    )
  }
  const name = (
    <span className="font-medium">
      <ProviderLabel id={provider.id} name={provider.name} />
    </span>
  )
  const address = answer.from.email || answer.from.phone
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        {lead}
        {link ? (
          <PluginLink to={providerPath(provider.id)} className="underline">
            {name}
          </PluginLink>
        ) : (
          name
        )}
        {provider.driver && (
          <span className="font-mono text-xs">{provider.driver}</span>
        )}
        {provider.enabled === false && <DisabledProviderBadge />}
      </p>
      <p>{VIA_TEXT[answer.via]}</p>
      {from && (answer.from.name || address) && (
        <p>
          From{answer.from.name ? ` ${answer.from.name}` : ""}
          {address && (
            <>
              {" "}
              <span className="font-mono text-xs">{address}</span>
            </>
          )}
        </p>
      )}
    </div>
  )
}
