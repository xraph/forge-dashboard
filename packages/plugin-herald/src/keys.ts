/*
 * Scope-relative paths. The host mounts them under /@herald. Every segment is
 * encoded: provider and message IDs are server-made, but nothing here should
 * depend on that.
 */
const seg = encodeURIComponent

export const newProviderPath = "/new-provider"
export const providerPath = (id: string) => `/providers/${seg(id)}`
export const providerEditPath = (id: string) => `/providers/${seg(id)}/edit`
export const providerSendTestPath = (id: string) => `/providers/${seg(id)}/send-test`
export const templatePath = (id: string) => `/templates/${seg(id)}`
export const messagePath = (id: string) => `/messages/${seg(id)}`
export const messageSendTestPath = (id: string) => `/messages/${seg(id)}/send-test`
