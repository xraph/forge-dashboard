/*
 * Paths to one record's pages. Every link to a record goes through these, so
 * no page builds a path by hand and forgets to encode the id.
 */
const seg = (id: string) => encodeURIComponent(id)

export const planPath = (id: string) => `/plans/${seg(id)}`
export const planEditPath = (id: string) => `/plans/${seg(id)}/edit`
export const featurePath = (id: string) => `/features/${seg(id)}`
export const featureEditPath = (id: string) => `/features/${seg(id)}/edit`
export const couponPath = (id: string) => `/coupons/${seg(id)}`
export const couponEditPath = (id: string) => `/coupons/${seg(id)}/edit`
export const subscriptionPath = (id: string) => `/subscriptions/${seg(id)}`
export const invoicePath = (id: string) => `/invoices/${seg(id)}`
