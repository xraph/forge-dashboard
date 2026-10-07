import { useEffect, useRef, useState } from "react"

/**
 * The open and closed state of an inline edit form, with focus kept where a
 * keyboard user expects it.
 *
 * The trigger unmounts while the form is open, and the form unmounts when
 * it closes, so without help focus falls to the document body both ways.
 * The form moves focus into itself on mount (focus its first field from a
 * mount effect); this hook puts focus back on the trigger after a close,
 * once the trigger has rendered again. Attach `triggerRef` to the button
 * that opens the form.
 */
export function useEditToggle() {
  const [editing, setEditing] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)

  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false
      triggerRef.current?.focus()
    }
  }, [editing])

  return {
    editing,
    triggerRef,
    open: () => setEditing(true),
    close: () => {
      refocus.current = true
      setEditing(false)
    },
  }
}
