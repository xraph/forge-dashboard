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

/**
 * Greedy packing: a two-unit item (an escape pair or a surrogate pair) is never
 * split across parts, so it moves whole to the next one when it does not fit.
 */
function segmentsFor(costs: number[], single: number, multi: number): { segments: number; perSegment: number } {
  const units = costs.reduce((n, c) => n + c, 0)
  if (units === 0) return { segments: 0, perSegment: single }
  if (units <= single) return { segments: 1, perSegment: single }
  let segments = 1
  let used = 0
  for (const cost of costs) {
    if (used + cost > multi) {
      segments += 1
      used = 0
    }
    used += cost
  }
  return { segments, perSegment: multi }
}

export function countSms(text: string): SmsCount {
  const gsmCosts: number[] = []
  let gsm = true
  for (const ch of text) {
    if (BASIC.has(ch)) gsmCosts.push(1)
    else if (EXTENSION.has(ch)) gsmCosts.push(2)
    else {
      gsm = false
      break
    }
  }
  if (gsm) return { encoding: "GSM-7", units: gsmCosts.reduce((n, c) => n + c, 0), ...segmentsFor(gsmCosts, 160, 153) }
  // UCS-2 counts UTF-16 code units: a character outside the basic plane is two.
  const ucsCosts = [...text].map((ch) => ((ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1))
  return { encoding: "UCS-2", units: ucsCosts.reduce((n, c) => n + c, 0), ...segmentsFor(ucsCosts, 70, 67) }
}
