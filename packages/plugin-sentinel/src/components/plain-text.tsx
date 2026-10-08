import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import { formatCount } from "../format"

/**
 * Text exactly as it came: never markdown, never HTML, never a link, with long
 * lines wrapped. Every input, output, reason and trace field goes through this
 * or a plain span, because a red-team output is an attack and a model's output
 * is untrusted either way.
 */
export function PlainText({ value, label }: { value: string; label: string }) {
  return (
    <pre
      aria-label={label}
      className="max-h-96 overflow-auto rounded-md border p-3 font-mono text-xs break-words whitespace-pre-wrap"
    >
      {value}
    </pre>
  )
}

/**
 * Output that may be an attack's payoff, collapsed until somebody asks for it:
 * "Show output (1,284 characters, leakage)". The reveal belongs to this one
 * result and is forgotten on reload, because nothing stores it.
 */
export function RevealText({
  value,
  length,
  attackType,
  label,
}: {
  value: string
  /** Characters, as the server counts them. */
  length: number
  attackType: string
  label: string
}) {
  const [shown, setShown] = useState(false)
  if (!shown) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border border-dashed p-3">
        <p className="text-sm text-muted-foreground">
          Red-team output stays hidden until you ask for it: it may repeat the
          system prompt or carry the attack.
        </p>
        <IconButton
          variant="outline"
          onClick={() => setShown(true)}
          label={`Show ${label.toLowerCase()} (${formatCount(length)} characters, ${attackType})`}
        />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <PlainText value={value} label={label} />
      <IconButton
        variant="ghost"
        className="self-start"
        onClick={() => setShown(false)}
        label={`Hide ${label.toLowerCase()}`}
      />
    </div>
  )
}
