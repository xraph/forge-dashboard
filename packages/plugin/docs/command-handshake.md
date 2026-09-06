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

The idempotency key is generated once per logical command. That happens at the
public `command()` entry point, not inside the per-attempt envelope build:

    async command<T = unknown>(
      contributor: string,
      intent: string,
      payload?: unknown,
      opts: { idempotencyKey?: string } = {},
    ): Promise<T> {
      return this.send<T>({
        kind: "command",
        contributor,
        intent,
        payload,
        idempotencyKey: opts.idempotencyKey ?? crypto.randomUUID(),
      });
    }

That resolved value then flows unchanged into every envelope built for that
command, including the CSRF-retry envelope, which is a second HTTP request for
the same logical command. The per-attempt envelope build just reads it back;
it does not generate it:

    csrf: input.kind === "command" ? this.csrfToken ?? undefined : undefined,
    idempotencyKey: input.idempotencyKey,

This split is deliberate, and it is what makes the retry safe. Regenerate the
key inside the per-attempt build instead, and a CSRF-refresh retry mints a
second, different idempotency key for what the server should see as one
command attempt. That defeats the entire reason to have one. Implement this
handshake by computing the `?? crypto.randomUUID()` fallback exactly once,
where the command is entered, and thread that single value unchanged through
every attempt, however many times the envelope itself gets rebuilt.

The shell also retried once on a 401 after refreshing the token, which is worth
copying: a cached token outlives its TTL silently otherwise. The retry is
capped at one attempt by a boolean flag threaded through the retry call, so a
second 401 in a row is a genuine failure, not a silent loop.

## Why this is not implemented in `@forge-go/dashboard-plugin` yet

W2 shipped `ScopedClient.command` without any of the above, so it failed 100% of the
time against a real server while its unit test passed against a mocked fetch. The
final review caught it and the method was removed rather than half-fixed, on the
spec's rule that API without a working consumer is what this rewrite exists to stop.

W5 builds authsome's login UI. Login is a command. That is the first genuine
consumer, and the hook lands with it — not before.
