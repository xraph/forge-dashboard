# What the server demands of a command

The client half of this handshake is implemented, in `../src/client.ts`. Read
`createScopedClient` there: the CSRF fetch, the cache, the single-attempt retry
and the one thing worth being careful about (the idempotency key is minted at
the `command()` entry point and threaded unchanged through every attempt) all
carry their reasoning in doc comments beside the code that does the work.

This file used to carry that description too, written in W3 when the only
working implementation was being deleted and there was nowhere else for it to
live. There is somewhere else now. What is left here is the half that lives in
the other repo, which this one cannot see and a reader of `client.ts` would
otherwise have to take on faith.

## The rules, and where they are enforced

`extensions/dashboard/contract/transport/http.go` rejects every `kind: command`
envelope whose `idempotencyKey` or `csrf` is empty, with 400 and
`CodeBadRequest`. That check runs **before** the CSRF manager is consulted, so
it fires whether or not contract security is enabled. Deliberate: a command
with no idempotency key is unsafe to retry either way.

A token that fails to validate gets **403 with code `UNAUTHENTICATED`**, from
the same function. Not 401. 401 comes from `extensions/dashboard/auth`, one
layer out, and means the session is gone, which a fresh CSRF token will not
fix. The retry in `client.ts` covers both, and only those: any other 403 is a
real denial.

`GET {contractBase}/csrf` returns `{ "token": string, "expiresAt": string }`
from `contract/transport/csrf.go`. `extension.go` mounts it only when
`EnableContractSecurity` is on and a CSRF manager exists (both default true),
with a 12h TTL. Where it is off the endpoint 404s, `refreshCSRF` gives up
quietly, and the command then fails on the transport's own presence check with
the server's own message.
