# Auth Implementation Plan — Backend (`analyrics-be`)

> Full design rationale lives in `docs/auth-plan.md`. This file is the
> execution checklist. Before starting any task, read that task's section in
> `docs/auth-plan.md` — it contains traps that are not repeated here.

## Testing policy for this plan

Deliberately trimmed. Do **not** implement the full §6 verification suite.

**Write unit tests only for the three pure utility modules** (BE-3, BE-4).
They have zero DI, run in milliseconds, and hold the security-critical logic.
2–4 cases each is enough — cover the trap named in the task, not every branch.

**For every other task, "verified" means:**
- `npm run build` passes
- `npm run lint` passes
- the manual curl check listed in that task returns what it says

**Explicitly out of scope:** integration tests against real Postgres, the
`test/auth.e2e-spec.ts` suite, service tests with mocked repositories. They are
listed in `docs/auth-plan.md` §6 for later, not now.

For tasks with no unit test (config, schema, wiring), skip the RED step of the
TDD cycle — there is nothing meaningful to fail first. Go straight to
implement → build → lint → manual check.

---

## BE-1 — Proxy trust + CORS exposed header ✅ DONE

Ref: `docs/auth-plan.md` §3 Phase 0 (P1, P4)

Two config lines that must land before anything touches auth, because
`/auth/me` runs on every page load and would otherwise share one global
rate-limit bucket behind Render's proxy.

- `src/main.ts`: set `trust proxy` to `1` before `app.listen`
- CORS config: add `exposedHeaders: ['X-Token-Expired']`

**Acceptance:** build + lint pass. `curl -H 'X-Forwarded-For: 1.2.3.4'` against
any endpoint is rate-limited per that IP, not globally.

**Tests:** none.

---

## BE-2 — `RefreshToken` model, migration, env ✅ DONE

Ref: `docs/auth-plan.md` §3 B1, B2 (and P2's leftover)

- `prisma/schema.prisma`: add `model RefreshToken` and `enum RevokeReason`
  exactly as specified in B1
- Add the back-relation `refreshTokens RefreshToken[]` to `model User`
  (Prisma fails `P1012` without it)
- Comment on `tokenHash` explaining why sha256 and not bcrypt — a reviewer
  will try to change it
- Run `npm run db:migrate -- --name add_refresh_token`
- Add the matching Joi entry in `app.module.ts` using the existing
  `isUsableJwtExpiresIn` validator, plus a cross-check that refresh TTL >
  access TTL

**Acceptance:** migration applies cleanly against the dev DB. App starts. App
refuses to start when `REFRESH_TOKEN_EXPIRES_IN` is missing or shorter than
`JWT_EXPIRES_IN`.

**Tests:** none — verify by starting the app with a deliberately bad env value.

---

## BE-3 — Duration parsing + cookie helpers ✅ DONE — **TESTED**

Ref: `docs/auth-plan.md` §3 B3

- ✅ DONE (landed with BE-2) **Modify** `src/auth/utils/jwt-expiry.util.ts`:
  add `parseDurationToMs(raw): number`, reusing `JWT_EXPIRES_IN_PATTERN` so it
  cannot drift from `resolveJwtExpiresIn`. Pulled forward because BE-2's
  Joi cross-check (refresh TTL > access TTL) cannot be written without it, and
  a throwaway second parser would have been the only alternative. Its spec
  (`jwt-expiry.util.spec.ts`, incl. the inverted-`ms` trap) is green already.
  Note: the BE-2 version shipped *without* B3's second half — `Math.round` for
  the fractional-with-unit case — which was added here along with a test that
  `parseDurationToMs('1.5ms') === 2`.
- **Create** `src/auth/utils/auth-cookies.util.ts`: `ACCESS_COOKIE`,
  `REFRESH_COOKIE`, `REFRESH_COOKIE_PATH`, `baseCookieOptions(isProd)`,
  `setAuthCookies()`, `clearAuthCookies()`
- `maxAge` derived from env via `parseDurationToMs` — never a hardcoded literal
- Clear must mirror set on every attribute except `maxAge`

**Tests (write these):**
- `jwt-expiry.util.spec.ts` — the inverted-`ms` trap:
  `parseDurationToMs('3600') === 3_600_000` (not `3_600`); `'7d'` →
  `604_800_000`; `'30d'` → `2_592_000_000`
- `auth-cookies.util.spec.ts` — prod gives `sameSite:'none', secure:true`, dev
  gives `lax`; set and clear options are attribute-identical except `maxAge`;
  refresh path is exactly `/api/auth`

**Acceptance:** both spec files green, build + lint pass.

---

## BE-4 — Refresh decision state machine ✅ DONE — **TESTED**

Ref: `docs/auth-plan.md` §3 B5

**Create** `src/auth/utils/refresh-decision.util.ts` as a **pure function**
`(row | null, now, graceMs) → RefreshDecision`. Do not inline this in the
service — extracting it is what makes it testable without a database.

Implement the five-branch table in B5 exactly. Grace window: 5 seconds.

**Tests (write these) — the grace branch is the point of this task:**
- revoked `ROTATED` 3s ago, `graceUsedAt` null → grace, **`clearCookies === false`**
- revoked 30s ago → reuse
- revoked 3s ago with reason `REUSE` → reuse, never grace
- revoked 3s ago with `graceUsedAt` already set → reuse
- hash not found → reject

**Acceptance:** spec green, build + lint pass.

The `clearCookies === false` case is the single easiest bug to introduce here —
if it clears, the winner's fresh cookie is destroyed by the loser's response.

---

## BE-5 — Repositories ✅ DONE

Ref: `docs/auth-plan.md` §3 B4

- **Modify** `auth.repository.ts` + `.impl.ts`: add `findById`
- **Create** `refresh-token.repository.ts` + `.impl.ts` following the
  abstract-class-as-DI-token pattern: `issue`, `claimAndRotate`, `findByHash`,
  `revokeFamily`, `markGraceUsed`, `deleteExpiredForUser`

`claimAndRotate` must use the conditional `updateMany` as the mutex — a plain
`$transaction` does not give mutual exclusion under READ COMMITTED. Type the
callback param `Prisma.TransactionClient`, never `any`.

Returning `Err` inside an interactive transaction does **not** roll it back.
Use a private sentinel throw inside the callback, caught at the repository
boundary and mapped to `Err('Hệ thống bị lỗi, vui lòng thử lại sau.')`.

**Acceptance:** build + lint pass. Manual: insert a token row, call
`claimAndRotate` twice in a row with the same hash — the second returns
`NOT_CLAIMED`.

**Tests:** none at this level. The 20-parallel-call check was nonetheless run
*once, manually* against the dev DB as part of the acceptance probe (1 winner /
19 `NOT_CLAIMED` / 1 child row); it was not committed as an automated test, per
the testing policy above.

> **Resolved in BE-6, not BE-8:** `IRefreshTokenRepository` had to be registered
> in `auth.module.ts` for BE-6's manual acceptance to run at all, so that one
> line moved earlier. BE-8's remaining module work is `exports: [AuthService]`.

---

## BE-6 — `AuthService` ✅ DONE

Ref: `docs/auth-plan.md` §3 B6

- `login` — verify password, start a new family, issue both tokens,
  fire-and-forget `deleteExpiredForUser` with swallowed rejection
- `register` — issue tokens too (signature change:
  `Result<IUser, string>` → login-shaped result)
- `refresh` — claim (BE-5) then diagnose (BE-4). **Re-read the user from the
  DB and sign from current state** — never copy `role` from the old token
- `logout` — revoke the presented token's family only; lookup must **not**
  filter `revokedAt: null`; derive `familyId` from the row, never the request;
  idempotent
- Add a code comment at the logout path stating that outstanding access tokens
  survive up to 7 days
- Add a `Logger` — there is none in `src/auth/` today, and unlogged reuse
  detection is detection that does not exist

Token: `randomBytes(32).toString('base64url')`, stored as
`createHash('sha256').update(token).digest('hex')`.

**Acceptance:** build + lint pass. Manual curl: login returns both cookies;
logout twice in a row both return 200.

**Tests:** none. Verified instead by two manual probes: a curl sequence
(register / login / logout x3 with the same revoked token / logout with garbage /
logout with no cookie — all 200) and a Nest application-context probe driving
`AuthService.refresh` directly, since `/auth/refresh` has no route until BE-8.
The probe confirmed rotation, `role` re-read from the DB (USER -> ADMIN mid-session),
grace with `clearCookies === false`, reuse on the second replay revoking the whole
family, and idempotent logout — 23 checks, all passing. Neither probe was committed.

> **Scope note — BE-6 had to reach into BE-8's files.** BE-6's own acceptance
> ("login returns both cookies", "logout twice returns 200") cannot be observed
> without a controller that sets cookies and a registered repository provider.
> So this task also made the *minimal* controller and module changes needed to
> compile and boot: `login`/`register` call `setAuthCookies`, `logout` reads the
> refresh cookie and calls `clearAuthCookies`, and the repository provider is
> registered. **No new routes, no Swagger additions, no throttle constants** —
> those remain BE-8's.

---

## BE-7 — Guard, strategy, interfaces ✅ DONE

Ref: `docs/auth-plan.md` §3 B7

- `jwt.interface.ts`: add **optional** `exp?: number` to `IAuthUser` (required
  would be a compile error under `strictNullChecks`). Update the doc comment at
  lines 9–13 in the same change — it currently claims `IAuthUser` is not a
  claims bag
- `jwt.strategy.ts`: map `exp`
- `at.guard.ts`: set header `X-Token-Expired: 1` when `info instanceof
  TokenExpiredError`, still return `null`. Drop both `any`s while here

**Acceptance:** build + lint pass. Manual: a request carrying an expired token
returns 200 with `X-Token-Expired: 1` and behaves as a guest.

**Tests:** none. Verified by signing a deliberately-expired token with the real
`JWT_SECRET`: `GET /auth/me` returned 200, `X-Token-Expired: 1`, and a guest body.
Two controls also checked — a *valid* token carries no such header, and a
*malformed* token is a guest **without** the header (so "expired" stays
distinguishable from "garbage"). `TokenExpiredError` is imported from
`@nestjs/jwt`, which re-exports it, rather than from `jsonwebtoken` — the latter
is only a transitive dependency.

---

## BE-8 — Controller, DTOs, module ✅ DONE

Ref: `docs/auth-plan.md` §3 B8

> **Already done during BE-6 — do not redo:**
> - `setAuthCookies` in login/register, `clearAuthCookies` in logout
> - `IRefreshTokenRepository` provider registered in `auth.module.ts`
>
> **Still pending for BE-8:** the `/refresh` and `/me` routes, DTOs,
> `LOGIN_*`/`REFRESH_*` throttle constants, Swagger decorators,
> `exports: [AuthService]`, `Cache-Control: no-store`.

Five routes per the B8 table. `login`, `register` and `logout` already exist and
are already wired to cookies (BE-6); what is missing is `/auth/refresh` and
`/auth/me`, plus the cross-cutting items below. Key constraints:

- **No endpoint may return a null `data`** — `/auth/me` returns
  `{ user: null }` for guests, never a bare `null`
- `accessTokenExpiresAt` is absolute epoch **milliseconds** (`exp * 1000`)
- `@Throttle` on login / register / refresh, **not** on `/auth/me`. Add
  `LOGIN_*` / `REFRESH_*` constants to `src/shared/constants/throttle.ts`
- Swagger decorators on `register` and `logout`; `@ApiCookieAuth()`
- `auth.module.ts`: add `exports: [AuthService]` (the repository provider was
  already registered in BE-6 — see its scope note)

**Acceptance:** build + lint pass. Manual curl sequence:
`register → me → logout → me (user null) → login → refresh → me`.
The refresh cookie carries `Path=/api/auth`. `/auth/me` as a guest is 200 with
non-null `data`.

**Tests:** none. The full sequence was run and passed, plus over-HTTP checks of
the branches that matter: replaying a just-rotated token returns 401 with
`data.retryable: true` and **zero `Set-Cookie` headers** (the winner's fresh
cookie survives); replaying it a second time returns `retryable: false` and
clears both cookies. Throttles measured exactly: login 429 at attempt #11
(limit 10), refresh 429 at #31 (limit 30), a different `X-Forwarded-For` gets its
own bucket, and `/auth/me` still answers 200 from an IP whose login budget is
exhausted. Swagger renders a `cookie` apiKey scheme that `refresh`/`logout`/`me`
reference and `login`/`register` correctly do not.

> **Two additions beyond the checklist.** `Cache-Control: no-store` is applied by
> a controller-wide `NoStoreInterceptor` rather than `@Header()`, because these
> handlers inject `@Res()` — which takes Nest out of the response pipeline, so
> `@Header()` would never fire — and an interceptor also covers routes added
> later. And `main.ts` now calls `.addCookieAuth('access_token')` in place of
> `.addBearerAuth()`: nothing referenced the bearer scheme, `JwtStrategy` has no
> Authorization-header extractor, and `@ApiCookieAuth()` needs a named scheme to
> resolve against.

> **`IRefreshFailure` gained a `kind` discriminant** (`INVALID | RACE | SYSTEM`).
> `clearCookies` and `retryable` alone cannot separate "lost a rotation race"
> from "the database is down" — both are retryable and both must leave cookies
> intact — yet one is a 401 about the token and the other a 500 about the server.
> Without the discriminant, infrastructure faults would have been buried in the
> 401 count.

---

## BE-9 — CSRF origin-check middleware ✅ DONE

Ref: `docs/auth-plan.md` §3 Phase 0 (P3)

Must land **with or before** BE-8 ships — switching to `SameSite=None` removes
the accidental CSRF protection that `sameSite: 'lax'` was providing.

**Create** `src/shared/middleware/origin-check.middleware.ts` rejecting
state-changing methods (`POST/PUT/PATCH/DELETE`) whose `Origin` is not in the
existing CORS allowlist.

**Acceptance:** build + lint pass. Manual: a `POST` with
`Origin: https://evil.example` is rejected; the same `POST` with the real
frontend origin passes.

**Tests:** none. Verified over HTTP: evil origin -> 403 on `/auth/login`,
`/auth/refresh` and `/analysis/analyze`; the real origin reaches the handler in
each case. `GET`/`HEAD` pass even from an evil origin (and with no Origin at
all), `OPTIONS` preflight still returns 204, and five near-miss origins were all
rejected — suffix (`http://localhost:3000.evil.example`), scheme
(`https://localhost:3000`), port (`http://localhost:30000`), the literal
`null`, and a query-string smuggle. The whole BE-8 sequence was re-run with the
middleware active with no regression.

> **The allowlist was extracted, not duplicated.** `main.ts` had the origin
> resolution inline; the middleware needed the same list. Both now call
> `resolveAllowedOrigins()` in **`src/shared/config/allowed-origins.ts`**, because
> drift between them fails silently in the dangerous direction: a request CORS
> would have blocked still gets *executed*, its response merely unreadable — the
> side effect has already happened.

> **Two judgment calls.** (1) A **missing** `Origin` on a state-changing method is
> **rejected**. Browsers always send it on such requests, so its absence means a
> non-browser caller, and every legitimate writer of this API is a browser. The
> cost: `curl -X POST` now needs `-H 'Origin: …'`. If a server-to-server or SSR
> caller is ever added, this is the line it will hit — the middleware logs the
> blocked method and path at `warn` so that is diagnosable rather than mysterious.
> (2) **Same-origin is allowed**, computed from the request rather than config, so
> Swagger's "Try it out" at `/api/docs` keeps working. Safe by construction: a
> request can only carry this server's origin if it came from a page this server
> served.

> **Express 5 detail:** registered as `forRoutes('{*path}')`. A bare `'*'` boots
> but emits a `LegacyRouteConverter` deprecation warning — path-to-regexp v8
> requires a named wildcard.

---

## Done criteria for the backend half ✅ MET

All nine tasks complete, `npm run build` and `npm run lint` clean, and the
manual curl sequence in BE-8 passes end to end (re-verified after BE-9). The
frontend plan in `analyrics-fe` is now unblocked.

> **Before deploying:** `REFRESH_TOKEN_EXPIRES_IN` is `required()` in the Joi
> schema, so production will refuse to boot until it is set there.
>
> **Local `.env` currently has `JWT_EXPIRES_IN="5s"`**, not `7d`. That is not a
> code defect — the chain is env-driven and was re-confirmed correct
> (`JWT_EXPIRES_IN=7d` yields `exp - iat = 604800`) — but a 5-second access
> token makes manual testing behave oddly, so restore it before judging any
> session behaviour.
