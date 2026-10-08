declare module "*nexus-fixtures.mjs" {
  export function resetNexus(): void
  export const nexusState: {
    tenants: Map<string, unknown>
    keys: Map<string, unknown>
    records: unknown[]
  }
  export function createNexusHandlers(
    ErrorType: new (status: number, code: string, message: string) => Error
  ): Record<
    string,
    { kind: string; handler: (params: Record<string, unknown>) => unknown }
  >
}
