import type { ReactNode } from "react"
import { cn } from "../lib/utils"

export interface AuthLayoutProps {
  /** The heading. Every auth screen has exactly one. */
  title: string
  description?: string
  /** From the provider's `config` intent. */
  brand?: string
  /**
   * The Forge server this screen signs in to.
   *
   * Not decoration. Run more than one Forge and these screens are otherwise
   * indistinguishable, so this is the only thing on the page telling you which
   * machine you are about to hand a password to.
   */
  serverHost?: string
  children: ReactNode
  footer?: ReactNode
  className?: string
}

/**
 * The shell every auth screen renders inside, and the denied state too.
 *
 * A split panel above 768px and a single column below it, where the left panel
 * collapses to a header strip. One component for all six surfaces so they
 * cannot drift apart.
 */
export function AuthLayout({
  title,
  description,
  brand = "Forge dashboard",
  serverHost,
  children,
  footer,
  className,
}: AuthLayoutProps) {
  return (
    <div className={cn("flex min-h-svh flex-col md:flex-row", className)}>
      <aside className="flex flex-col justify-between gap-6 border-b bg-muted/40 p-6 md:w-2/5 md:max-w-sm md:border-r md:border-b-0 md:p-10">
        <div>
          <div
            aria-hidden="true"
            className="size-8 rounded-lg bg-gradient-to-br from-primary to-primary/60"
          />
          <p className="mt-4 font-semibold text-xl leading-tight tracking-tight">
            {brand}
          </p>
          <p className="mt-2 text-muted-foreground text-sm">
            Every extension, one console.
          </p>
        </div>
        {serverHost ? (
          <p className="font-mono text-muted-foreground text-xs">{serverHost}</p>
        ) : null}
      </aside>

      <main className="flex flex-1 items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1.5 text-muted-foreground text-sm">{description}</p>
          ) : null}
          <div className="mt-6">{children}</div>
          {footer ? (
            <div className="mt-6 text-center text-sm">{footer}</div>
          ) : null}
        </div>
      </main>
    </div>
  )
}
