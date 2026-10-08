import { useCallback, useEffect, useRef, useState } from "react"
import type { ComponentProps } from "react"
import { Input } from "@forge-go/dashboard-kit/components/input"

/**
 * Write-only values, kept where nothing else can read them.
 *
 * A secret lives in its password field's own DOM value for as long as it
 * takes to type it and for one request. It is never React state, never a
 * query param, never a label or an error string. Only whether a field is
 * empty is tracked, to gate Save. `read()` collects the values at submit,
 * `clear()` empties every field after a success; on failure nothing is
 * cleared, so the operator can retry without retyping.
 *
 * The fields are uncontrolled on purpose: React copies a controlled input's
 * value into its `value` attribute, password or not, and anything that
 * serialises markup can then read it.
 */
export function useSecretFields() {
  const inputs = useRef(new Map<string, HTMLInputElement>())
  const [filled, setFilled] = useState<ReadonlySet<string>>(new Set())

  const register = useCallback(
    (name: string) => (el: HTMLInputElement | null) => {
      if (el) inputs.current.set(name, el)
      else inputs.current.delete(name)
    },
    []
  )

  const onInput = useCallback((name: string, value: string) => {
    setFilled((prev) => {
      const next = new Set(prev)
      if (value === "") next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  /** Called from submit handlers only, never while rendering. */
  const read = useCallback((): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const [name, el] of inputs.current)
      if (el.value !== "") out[name] = el.value
    return out
  }, [])

  const clear = useCallback(() => {
    for (const el of inputs.current.values()) el.value = ""
    setFilled(new Set())
  }, [])

  /** A field left the page: it no longer counts as filled, whatever it held. */
  const forget = useCallback((name: string) => {
    setFilled((prev) => {
      if (!prev.has(name)) return prev
      const next = new Set(prev)
      next.delete(name)
      return next
    })
  }, [])

  return { register, onInput, read, clear, forget, filled }
}

export type SecretFields = ReturnType<typeof useSecretFields>

/** "new-password" rather than "off": browsers ignore "off" on password fields. */
export function SecretInput({
  name,
  secrets,
  ...rest
}: { name: string; secrets: SecretFields } & Omit<
  ComponentProps<"input">,
  "type" | "value" | "defaultValue" | "ref" | "onChange" | "name"
>) {
  const { forget } = secrets
  // An input that unmounts (Keep, Remove, a driver change) takes its typed
  // value with it, so it must stop counting as filled. Otherwise Save would
  // trust a replacement that is no longer there.
  useEffect(() => () => forget(name), [forget, name])
  return (
    <Input
      {...rest}
      type="password"
      autoComplete="new-password"
      spellCheck={false}
      ref={secrets.register(name)}
      onChange={(e) => secrets.onInput(name, e.target.value)}
    />
  )
}
