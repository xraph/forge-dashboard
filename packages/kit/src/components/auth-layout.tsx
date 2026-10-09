import type { ReactNode } from "react"
import { MoonIcon, SunIcon } from "../icons"
import { ForgeMark } from "./brand-marks"
import { Button } from "./button"
import { setDocumentTheme, useDocumentTheme } from "./theme-provider"
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
  size?: "default" | "wide"
  density?: "default" | "compact"
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
  size = "default",
  density = "compact",
}: AuthLayoutProps) {
  const dark = useDocumentTheme() === "dark"

  return (
    <div
      className={cn(
        "flex min-h-svh flex-col overflow-hidden bg-background lg:flex-row",
        className
      )}
    >
      <aside className="relative isolate min-h-40 overflow-hidden bg-[#141414] text-white lg:min-h-svh lg:w-[42%] lg:max-w-[34rem]">
        <ForgeMark className="pointer-events-none absolute -right-16 -bottom-20 hidden size-80 text-white/[0.035] lg:block" />
        <div className="relative flex min-h-40 flex-col justify-between gap-6 px-6 py-5 sm:px-8 lg:min-h-svh lg:px-12 lg:py-10 xl:px-16 xl:py-14">
          <div className="flex items-center gap-3">
            <ForgeMark
              className="size-8 shrink-0 text-white lg:size-9"
              data-slot="forge-mark"
            />
            <p className="text-[0.9375rem] leading-tight font-medium tracking-[-0.01em] text-white/95 lg:text-base">
              {brand}
            </p>
          </div>

          <div className="hidden max-w-sm lg:block">
            <p className="text-[2rem] leading-[1.12] font-medium tracking-[-0.045em] text-white xl:text-[2.375rem]">
              Every extension,
              <br />
              one console.
            </p>
            <p className="mt-4 max-w-xs text-sm leading-6 text-white/50">
              Secure access to the services and tools that run your platform.
            </p>
          </div>

          {serverHost ? (
            <div className="flex items-center gap-2.5 text-xs lg:mb-8">
              <span className="text-white/40">Connected to</span>
              <span className="font-mono text-white/75">{serverHost}</span>
            </div>
          ) : (
            <div aria-hidden="true" />
          )}
        </div>
      </aside>

      <main
        className={cn(
          "relative flex min-h-[calc(100svh-10rem)] flex-1 items-center justify-center px-4 sm:px-6 lg:min-h-svh lg:px-10",
          density === "compact" ? "py-8 lg:py-10" : "py-10 lg:py-16"
        )}
      >
        <Button
          aria-label={dark ? "Use light theme" : "Use dark theme"}
          className="absolute top-5 right-5 text-muted-foreground sm:top-6 sm:right-6 lg:top-8 lg:right-8"
          onClick={() => setDocumentTheme(dark ? "light" : "dark")}
          size="icon"
          title={dark ? "Use light theme" : "Use dark theme"}
          type="button"
          variant="ghost"
        >
          {dark ? <SunIcon /> : <MoonIcon />}
        </Button>
        <div
          className={cn(
            "w-full",
            size === "wide" ? "max-w-[42rem]" : "max-w-[25rem]"
          )}
        >
          <h1 className="text-[1.375rem] leading-[1.15] font-semibold tracking-[-0.035em]">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
          <div
            className={
              density === "compact"
                ? "mt-4"
                : "mt-8 [&_form_button]:h-11 [&_form_input]:h-11"
            }
          >
            {children}
          </div>
          {footer ? (
            <div className="mt-5 border-t pt-4 text-center text-sm">
              {footer}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  )
}
