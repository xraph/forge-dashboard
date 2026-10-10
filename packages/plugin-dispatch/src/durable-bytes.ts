/** Encode the original text, refusing UTF-16 replacement and preserving BOMs. */
export function textBytes(value: string, limit = 1 << 20): Uint8Array {
  const bytes = new TextEncoder().encode(value)
  if (
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) !==
    value
  )
    throw new Error("Text contains an invalid Unicode character.")
  if (bytes.length > limit)
    throw new Error(`Input exceeds ${limit} UTF-8 bytes.`)
  return bytes
}
export function inputBase64(value: string) {
  return bytesBase64(textBytes(value))
}
export function validIdentifier(value: string, limit = 512) {
  try {
    // Go's Unicode White_Space excludes U+FEFF. Never use JS trim here.
    return (
      !!value &&
      !/\0|^\p{White_Space}|\p{White_Space}$/u.test(value) &&
      textBytes(value, limit).length > 0
    )
  } catch {
    return false
  }
}
export function outputBytes(value: string) {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
  if (
    btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")) !==
    value
  )
    throw new Error("Invalid base64 output")
  return bytes
}
export function outputText(value: string) {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    outputBytes(value)
  )
}

export function bytesBase64(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
}
