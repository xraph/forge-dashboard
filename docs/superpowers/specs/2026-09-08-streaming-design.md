# Streaming plugin: the other eleven intents

Status: approved, not implemented
Depends on: the plugin platform spec

Smallest of the four specs, and the only one with no gaps. The streaming
contract declares fourteen intents and the plugin uses three. Everything the
server offers can be built, so this one goes from three pages to feature
complete with no Go work at all.

## What is there

`extension: "streaming-contract"`, and yes the "-contract" suffix is part of the
name. It's the contributor name in `extensions/streaming/contract/manifest.yaml`.
Call it "streaming" and the plugin resolves to `hidden` and you get a dashboard
that's quietly missing three pages.

Three read-only pages today: overview (`stats`), rooms (`rooms.list`),
connections (`connections.list`). The package comment says read-only is
deliberate, that the command handshake gets exercised once by auth rather than
twice. That was right for one wave and it is not right now. The five commands
land here.

## Pages

Nav is flat. Six entries, no groups, because six entries do not need headings.

- `/` overview. The eight stat cards it already has, moved onto kit's
  `stat-grid`, plus an online-users panel `[stats, presence.list]`
- `/rooms` list, with create and delete
  `[rooms.list, rooms.create, rooms.delete]`
- `/rooms/:id` detail: room fields, member table, moderation log, and a send-message composer
  `[rooms.detail, rooms.members, rooms.moderation, rooms.send-message]`
- `/connections` list, with kick `[connections.list, connections.kick]`
- `/channels` list `[channels.list]`
- `/presence` list, with a status override `[presence.list, presence.set]`
- `/config` the deployment's streaming configuration `[config]`

`config` returns `backendType`, `distributed`, `nodeID` and three open maps
(`features`, `limits`, `timeouts`). Open maps get rendered as key/value tables
sorted by key rather than a hand-written field list, because the server is free
to add a limit tomorrow and a hand-written list would silently drop it.

## Commands

All five, all through `useCommand`, so CSRF and the idempotency key are minted
once in the client and threaded unchanged through every retry of one logical
command. No `crypto.randomUUID` in this package, same as everywhere else.

Destructive ones go through kit's `confirm-dialog`: `rooms.delete` and
`connections.kick`. Kicking a connection names the user and the transport in the
confirm, since connection ids are opaque and you shouldn't have to trust that
you clicked the right row.

Invalidation comes off `meta.invalidates`, which the streaming manifest declares
well: `rooms.create` invalidates `rooms.list` and `stats`, `connections.kick`
invalidates `connections.list` and `stats`. The overview refreshes after a room
is created without the rooms page knowing the overview exists.

## Polling

Streaming stats move continuously and a dashboard showing a five minute old
connection count is worse than useless. The overview and connections pages poll
`stats`, `connections.list` and `presence.list` on an interval, using the query
store's `staleTime` as the interval when the server sends a `cacheControl` hint
and ten seconds when it does not.

Polling pauses when the tab is hidden. A dashboard left open on a second monitor
overnight shouldn't hold a connection count query open eight thousand times.

## Timestamps

Every streaming type uses Go's `time.Time`, which marshals to RFC 3339, unlike
authsome's string fields that are sometimes empty. So the shared timestamp
formatter needs to handle both: an unparseable value prints as it arrived rather
than as "Invalid Date", and an empty string prints as an en dash. That formatter
moves into kit alongside `query-boundary` and both plugins use it.

## Testing

Every page: loading, error, empty, populated. Every command: the failure path.

Worth naming:

- `rooms.create` refreshes the overview's stats through server meta alone
- polling stops when the document is hidden and resumes when it is shown again
- `config`'s open maps render every key the server sent, including one the
  frontend has never heard of
- kick names the user, not just the connection id, in its confirm dialog

## Package layout

Stays `packages/plugin-streaming`. `src/components/query-view.tsx` is deleted and
its callers move to kit's `query-boundary`.
