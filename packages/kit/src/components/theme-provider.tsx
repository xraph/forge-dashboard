"use client"

import type { ComponentProps, ReactNode } from "react"
import { useEffect, useState } from "react"
import {
  ThemeProvider as NextThemesProvider,
  useTheme as useNextTheme,
} from "next-themes"

type ThemeProviderProps = ComponentProps<typeof NextThemesProvider>
export type ResolvedTheme = "light" | "dark"

export function resolveDocumentTheme(
  root: Element | null | undefined,
): ResolvedTheme {
  return root?.classList.contains("dark") ? "dark" : "light"
}

export function useDocumentTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>("light")

  useEffect(() => {
    const root = document.documentElement
    const read = () => setTheme(resolveDocumentTheme(root))
    read()

    if (typeof MutationObserver === "undefined") return
    const observer = new MutationObserver(read)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return theme
}

export function setDocumentTheme(theme: ResolvedTheme) {
  const root = document.documentElement
  root.classList.remove("light", "dark")
  root.classList.add(theme)
  root.style.colorScheme = theme
  localStorage.setItem("theme", theme)

  // Keep any host-owned next-themes provider in sync even when a linked
  // dashboard package resolves a separate copy of its React context.
  window.dispatchEvent(
    new StorageEvent("storage", { key: "theme", newValue: theme }),
  )
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']"),
  )
}

function ThemeKeyboardShortcut({ children }: { children: ReactNode }) {
  const { resolvedTheme, setTheme } = useNextTheme()

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target) ||
        event.key.toLowerCase() !== "d"
      ) {
        return
      }

      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [resolvedTheme, setTheme])

  return children
}

export function ThemeProvider({
  children,
  attribute = "class",
  defaultTheme = "system",
  enableSystem = true,
  disableTransitionOnChange = true,
  ...props
}: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute={attribute}
      defaultTheme={defaultTheme}
      disableTransitionOnChange={disableTransitionOnChange}
      enableSystem={enableSystem}
      {...props}
    >
      <ThemeKeyboardShortcut>{children}</ThemeKeyboardShortcut>
    </NextThemesProvider>
  )
}

export function useTheme() {
  return useNextTheme()
}
