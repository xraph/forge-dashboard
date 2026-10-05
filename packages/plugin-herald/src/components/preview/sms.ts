/*
 * SMS segment counting. GSM-7 fits 160 characters in one message and 153 per
 * part once split; anything outside the GSM alphabet sends the whole message
 * as UCS-2, 70 and 67. The extension table's characters cost two units each.
 * Counts are what carriers usually do, not a promise from any one of them.
 */
const BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
)
const EXTENSION = new Set("^{}\\[~]|€\f")

export interface SmsCount {
  encoding: "GSM-7" | "UCS-2"
  units: number
  segments: number
  perSegment: number
}

function segments(units: number, single: number, multi: number): { segments: number; perSegment: number } {
  if (units === 0) return { segments: 0, perSegment: single }
  return units <= single ? { segments: 1, perSegment: single } : { segments: Math.ceil(units / multi), perSegment: multi }
}

export function countSms(text: string): SmsCount {
  let units = 0
  let gsm = true
  for (const ch of text) {
    if (BASIC.has(ch)) units += 1
    else if (EXTENSION.has(ch)) units += 2
    else {
      gsm = false
      break
    }
  }
  if (gsm) return { encoding: "GSM-7", units, ...segments(units, 160, 153) }
  // UCS-2 counts UTF-16 code units: a character outside the basic plane is two.
  const ucs = [...text].reduce((n, ch) => n + ((ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1), 0)
  return { encoding: "UCS-2", units: ucs, ...segments(ucs, 70, 67) }
}
