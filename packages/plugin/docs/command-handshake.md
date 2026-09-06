# The command envelope handshake

Recorded 2026-09-05, during W3, immediately before `extensions/dashboard/contract/shell/`
was deleted. That package held the only working implementation of this handshake.

## The requirement

`extensions/dashboard/contract/transport/http.go` rejects every `kind: command`
envelope missing either field:

    if req.Kind == contract.KindCommand {
        if req.IdempotencyKey == "" || req.CSRF == "" {
            writeError(w, http.StatusBadRequest, &contract.Error{
                Code: contract.CodeBadRequest,
                Message: "command requires csrf and idempotencyKey"})
            return
        }
        if h.csrfMgr != nil && !h.csrfMgr.ValidateToken(req.CSRF) { ... }
    }

The presence check runs BEFORE the CSRF manager is consulted, so it fires whether or
not `EnableCSRF` is set. This is deliberate, not a bug: a command without an
idempotency key is unsafe to retry regardless of whether CSRF is enforced.

## The client side, as the deleted shell implemented it

Token fetch — `GET {contractBase}/csrf` returns `{ "token": string }`. The handler is
`extensions/dashboard/contract/transport/csrf.go`, `NewCSRFTokenHandler`, and it
survives W3.

    private async refreshCSRF(): Promise<void> {
      const res = await this.fetcher(this.resolveURL(`${this.baseURL}/csrf`), {
        credentials: "include",
      })
      if (!res.ok) { this.csrfToken = null; return }
      const body = (await res.json()) as { token: string }
      this.csrfToken = body.token
    }

Lazy refresh before the first command, then cache on the client instance:

    if (input.kind === "command" && !this.csrfToken) {
      await this.refreshCSRF()
    }

Envelope fields, set only for commands:

    csrf: input.kind === "command" ? this.csrfToken ?? undefined : undefined,
    idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),

The shell also retried once on a 401 after refreshing the token, which is worth
copying: a cached token outlives its TTL silently otherwise.

## Why this is not implemented in `@forge/dashboard-plugin` yet

W2 shipped `ScopedClient.command` without any of the above, so it failed 100% of the
time against a real server while its unit test passed against a mocked fetch. The
final review caught it and the method was removed rather than half-fixed, on the
spec's rule that API without a working consumer is what this rewrite exists to stop.

W5 builds authsome's login UI. Login is a command. That is the first genuine
consumer, and the hook lands with it — not before.
