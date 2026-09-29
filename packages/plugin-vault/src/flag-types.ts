/** The five value types a flag can have. Mirrors the Go `flag.Type`. */
export const FLAG_TYPES = ["bool", "string", "int", "float", "json"] as const

export type FlagType = (typeof FLAG_TYPES)[number]

export function isFlagType(value: string): value is FlagType {
  return (FLAG_TYPES as readonly string[]).includes(value)
}
