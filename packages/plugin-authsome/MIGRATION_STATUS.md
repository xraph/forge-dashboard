# Authsome dashboard migration status

The React dashboard reads the Forge dashboard contract. Authsome's old dashboard also calls plugin services directly from Go and renders templ pages. Keep that UI while it still provides actions that the contract does not expose.

## Settings

The Settings page reads `settings.namespaces` and gives you an editor for every namespace returned by the server. It uses the plugin's contributed editor when one exists, and the shared `settings.namespace` and `settings.update` editor for the rest. Authsome currently has 21 plugins with `DeclareSettings`. This includes Shared Signals, API key, and subscription settings even when they do not contribute a settings tab. The fixture now seeds their actual setting keys and defaults.

Email and Passkey register editable settings and appear in the shared editor. OAuth2 Provider does not register settings definitions, so its React settings route has no editable fields from `settings.namespace`. Add a read intent for its current configuration, or register settings and wire them into plugin behavior, before removing that panel. Consent, Organization, and Waitlist also have no registered settings definitions; their management pages use their own intents.

The shared editor currently writes at app scope. Global, organization, and user scope controls from the old settings editor still need an explicit React workflow and authorization review.

A registered field does not prove the plugin uses its saved value. API key limits, the anomaly risk threshold, and the email sender still read plugin config in their handlers, while this editor writes to `settings.Manager`. Check every plugin's runtime read path before you treat these settings as migrated. The new dashboard shows the registered values, but a saved value may not change plugin behavior yet.

## Plugin workflows still served by the old UI

| Plugin area | React coverage today | Work before removal |
| --- | --- | --- |
| API keys, Consent, Waitlist | List and available actions use their plugin intents | Compare all old detail and user actions against the contract |
| Organizations | Organization and member views, create, update, remove, and invite | Member role changes still need an intent and React action; verify the remaining organization plugin contributions against their old pages |
| Subscription | Plans, pricing tiers, entitlements, feature catalog, subscriptions, usage, invoices, and coupons have contract-backed React pages and write actions | Verify live Ledger behavior, provider effects, and the remaining old route details before deleting templ pages |
| MFA and Passkey | Registered settings when available | Enrollment and credential management pages have no plugin intents |
| Notification | Templates, locale versions, preview, test send, live send, defaults, event mappings, and registered settings have contract-backed React pages | The Herald bridge exposes no delivery-history query. Verify the live Herald adapter and each configured channel before removing templ pages |
| OAuth2 Provider, Social, SSO | Registered settings where available | Client and provider management pages have no plugin intents |
| SCIM | Registered settings | Provisioning views and logs have no plugin intents |
| Security plugins | Registered settings | Compare each old status and provider detail view; their contract manifests expose no plugin intents |
| Shared Signals | Five registered settings through the Authsome settings registry | Admin stream management uses its own HTTP routes and has no dashboard contributor |
| Authsome core | Accounts, sessions, devices, roles, apps, environments, forms, webhooks, settings, and live installed-plugin inventory | Authentication activity is not exposed by the current intents |

The old `dashboard` package is also imported by Authsome's anonymous auth pages and plugin dashboard contributors. Removing it requires replacing those imports and their tests, in addition to closing the feature gaps above. The removal gate is contract coverage, React workflows, and live verification for every old route and mutation.
