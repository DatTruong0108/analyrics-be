# Sign In / Sign Out — Implementation Plan

> Scope: `analyrics-be` (NestJS 11 + Prisma 6 + PostgreSQL) and `analyrics-fe`
> (Next.js 16 App Router + React 19 + Tailwind 4).
> Plan written in English per global guidelines; **all user-facing UI strings
> stay Vietnamese** to match the existing codebase.
>
> Every item is tagged **[Required]**, **[Recommended]** or **[Optional]** so the
> scope can be trimmed during review.

---

## 0. Already applied

Three items from the original plan have been done and verified:

| Change | File | Status |
|---|---|---|
| `cookie-parser`, `@nestjs/swagger`, `swagger-ui-express` moved `devDependencies` → `dependencies` | `analyrics-be/package.json` | ✅ `npm run build` passes |
| Dropped unused `bcrypt`, `passport-local` (+ their `@types`) — only `bcryptjs` is imported | `analyrics-be/package.json` | ✅ pruned via `npm install` |
| `FE_URL` / `FE_URL_PROD` added to `envValidationSchema` as required `http`/`https` URIs | `analyrics-be/src/app.module.ts` | ✅ real `.env` passes; missing/bare-host values blocked |
| `react-hooks/set-state-in-effect` error fixed | `analyrics-fe/src/components/dashboard/quoteSection.tsx` | ✅ `eslint` + `tsc` + `next build` clean |

Two notes on the env work:

- The scheme is pinned to `http`/`https`. Joi's bare `uri()` **accepts**
  `localhost:3000` (it parses as scheme `localhost`), which would pass startup
  and then produce a CORS origin no browser ever matches.
- The real deployed frontend is **`https://analyrics-nine.vercel.app`**, not
  `analyrics-fe.vercel.app` as first assumed. Still a `vercel.app` subdomain, so
  every cross-site conclusion below is unchanged.

`quoteSection.tsx` now uses `useSyncExternalStore` instead of
`useEffect` + `setState`. The effect existed to avoid a hydration mismatch (the
quote is random, so server and client can never agree); `useSyncExternalStore` is
the hook that states that directly — React must use `getServerSnapshot` for both
the SSR and hydration passes, then re-render. The shuffle button now also draws
from the *other* quotes, so it can no longer redraw the quote already on screen.

---

## 1. Context

The backend already ships a working auth module — `POST /api/auth/login`,
`/register`, `/logout` using bcryptjs + `@nestjs/jwt` + a passport-jwt strategy
that reads an httpOnly `access_token` cookie. The frontend, by contrast, has
**no auth at all**: every request runs as a guest.

The frontend is not merely missing the feature — it has a *placeholder for it*.
`src/components/dashboard/navBar.tsx:10` hardcodes `const user = { name: "Khách" }`,
which is always truthy, so the `Đăng ký` / `Đăng nhập` buttons at lines 25–26 are
**unreachable dead code with no `onClick`**. This task replaces that fake object
with a real session and wires those two buttons up.

**Intended outcome:** a visitor can register, sign in, stay signed in across
refreshes and browser restarts for 30 days, and sign out. Guests keep full access
to everything they can do today.

### Three blockers, and one thing that is already broken

1. **No `GET /auth/me`.** The cookie is `httpOnly`, so JavaScript cannot read it.
   After a page refresh the frontend has no way to discover whether it is signed in.
2. **`apiFetch` rejects data-less 200s.** `src/lib/api.ts:132-134` throws when
   `envelope.data` is null. `POST /auth/logout` returns `{ statusCode, message }`
   with no `data`, so logout throws despite a 200. The file's own comment at lines
   129-131 anticipates this and prescribes a separate helper.
3. **Production sign-in cannot work today.** `auth.controller.ts:52-54` sets the
   cookie `sameSite: 'lax'`. `vercel.app` and `onrender.com` are both entries on
   the Public Suffix List, so `analyrics-nine.vercel.app` ↔
   `analyrics-be.onrender.com` is **cross-site**. A `SameSite=Lax` cookie is
   stored but **never sent** on a cross-site `fetch`, even with
   `credentials: 'include'`.

Point 3 has a consequence worth stating plainly: **every production request to
`POST /api/analysis/analyze` has always been anonymous**, so the
`if (userId) recordUserHistory` branch in `analysis.service.ts` has likely never
fired in production. Two upsides — there are no live production sessions to
migrate (so `JWT_SECRET` can be rotated alongside this deploy for free), and
`UserHistory` will begin recording for real once this ships.

### Decisions taken

| Question | Decision |
|---|---|
| Register UI | **In scope.** `/auth/register` exists but is unreachable. |
| Route protection | **Nothing becomes auth-required.** Guests keep working as today. |
| Session model | **Refresh token rotation** with reuse detection. |
| Token lifetimes | Access **7d**, refresh **30d**. |
| Auth UI shape | **Modal** with `Đăng nhập` / `Đăng ký` tabs, opened from the navbar. |
| History payoff | **Out of scope.** `UserHistory` stays write-only. |

### ⚠️ What a 7-day access token costs — read before building

The lifetimes were set to 7d/30d deliberately, and this plan implements them. But
the choice moves real weight onto the access token, and three consequences should
be conscious decisions rather than discoveries:

1. **Sign-out does not revoke API access for up to 7 days.** Logout clears the
   cookies and kills the refresh family, so the *browser* is signed out — but the
   access JWT is stateless and stays valid until its own `exp`. Anyone holding a
   copy (XSS, a shared machine, a captured request) keeps full access for the
   remainder of the 7 days. At the originally-planned 15 minutes this was a
   footnote; at 7 days it is the main residual risk of the design.
2. **A demoted or deleted user keeps their old `role` for up to 7 days.** Refresh
   re-reads the user from the DB, but refresh only happens weekly now.
3. **Rotation fires roughly once a week**, so reuse detection has far fewer
   chances to notice a stolen family, and a compromised family survives longer.

Two ways to buy that back if any of the above is unacceptable — **neither is in
scope, both are cheap to add later**:

- Shorten the access token (`JWT_EXPIRES_IN=15m`) and keep the 30-day refresh.
  The session length users experience is set by the *refresh* token, so this costs
  nothing in convenience — it only means the silent refresh in F4 runs often
  instead of weekly.
- Add `tokenVersion Int` to `User`, checked in `JwtStrategy.validate`, so logout
  and password-change invalidate outstanding access tokens immediately. Costs one
  indexed DB read per authenticated request.

---

## 2. What already exists — do not rebuild

The house style is unusual; match it.

| Concern | Existing asset |
|---|---|
| Result handling | `oxide.ts` `Result<T, string>` — services return `Ok`/`Err`, **never throw**. Controllers `match(result, { Ok, Err })` writing to a raw `@Res() res`. |
| Error → status | `const isSystem = err.includes('Hệ thống'); status = isSystem ? 500 : 400;` (`auth.controller.ts:69-70`, `analysis.controller.ts:80-81`). |
| Response envelope | `BaseResponse` (`src/shared/constants/baseResponse.ts`) = `{ statusCode, message }`; concrete responses extend it with `data`. |
| DI pattern | Abstract class as token: `export abstract class IAuthRepository` (`auth.repository.ts:8`) + `{ provide, useClass }`. |
| Validation | class-validator DTOs, Vietnamese messages; pipe options in `src/shared/constants/validation.ts`. |
| Duration parsing | `src/auth/utils/jwt-expiry.util.ts` — `JWT_EXPIRES_IN_PATTERN`, `isUsableJwtExpiresIn()`, `resolveJwtExpiresIn()`. **Reuse these**; do not add an `ms` dependency. (Verified: the regex already parses `7d` and `30d`.) |
| Throttling | `src/shared/constants/throttle.ts` + `@Throttle` per handler. |
| Optional-auth guard | `AtGuard` returns `null` instead of 401 — deliberate, keeps guests working. |
| Current-user access | `@GetCurrentUserId()` → `string \| null`. |
| FE transport | `src/lib/api.ts` — `apiFetch`, `ApiError`, `isAbortError`. **`credentials: "include"` is already hardcoded** (line 79). |
| FE animation | `src/lib/motion.ts` — `scaleIn` (has `hidden`/`visible`/`exit`, ideal for the modal), `EASE_OUT`, `fadeInUp`. |
| FE style cribs | Input + primary button: `searchBar.tsx`. Glass card: `songCard.tsx`. Spinner: `loadingView.tsx`. |
| FE client-only render | `quoteSection.tsx` now demonstrates the `useSyncExternalStore` hydration gate — reuse that shape rather than reaching for an effect. |

FE conventions: `'use client';` first, then `/* System Package */`, then
`/* Application Package */`; four-space indent under `components/`/`lib/`;
`I`-prefixed interfaces; default exports; `@/*` alias.

---

## 3. Backend

### Phase 0 — Prerequisites

Pre-existing bugs, listed first because **this feature turns them from latent
into user-visible.**

**P1 · `trust proxy` is not set. [Required]** `app.module.ts` registers
`ThrottlerGuard` globally, but `main.ts` never sets `trust proxy`. Behind Render's
proxy `req.ip` is the *proxy's* address, so **every user in the world shares one
rate-limit bucket**. The moment `/auth/me` exists (hit on every page load) this
becomes a 429 storm that reads to users as random mass logout.

```ts
// src/main.ts, before app.listen
app.getHttpAdapter().getInstance().set('trust proxy', 1);
```

Prefer keying the login throttle on `dto.email` and the refresh throttle on the
token family (override `getTracker`) rather than on IP.

**P2 · CORS origin validation. ✅ DONE** — see §0. Still to add when the feature
lands: `REFRESH_TOKEN_EXPIRES_IN` (reusing the existing `isUsableJwtExpiresIn`
validator), plus a cross-check asserting refresh TTL > access TTL. It is
deliberately *not* in the schema yet, since making it required before the code
reads it would block startup.

**P3 · CSRF protection is about to be removed. [Required]** Today
`sameSite: 'lax'` is *accidentally* acting as CSRF protection — by breaking auth
entirely. Switching to `SameSite=None` (unavoidable, see §1.3) means any attacker
page could `fetch('…/api/analysis/analyze', { credentials: 'include' })` and spend
the victim's Gemini quota, or force a rotation on `/api/auth/refresh`.

Cheapest sufficient fix, since a CORS allowlist already exists: **create**
`src/shared/middleware/origin-check.middleware.ts` rejecting state-changing
methods (`POST/PUT/PATCH/DELETE`) whose `Origin` is not in the allowlist. No token
plumbing, no frontend changes. Scoping the refresh cookie to `/api/auth` does
**not** protect `/api/auth/refresh` itself.

**P4 · Expose the token-expiry signal. [Required]** Add
`exposedHeaders: ['X-Token-Expired']` to the CORS config (see B7). Without it the
browser will not let the frontend read the header at all.

### B1 — Prisma model **[Required]**

`analyrics-be/prisma/schema.prisma`

```prisma
model RefreshToken {
  id            String        @id @default(uuid())
  userId        String
  tokenHash     String        @unique @db.Char(64)   // sha256 hex
  familyId      String
  expiresAt     DateTime
  revokedAt     DateTime?
  revokedReason RevokeReason?                        // see B5
  graceUsedAt   DateTime?                            // see B5
  createdAt     DateTime      @default(now())

  user          User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, revokedAt])
  @@index([familyId])
  @@index([expiresAt])
}

enum RevokeReason { ROTATED  REUSE  LOGOUT }
```

**Add the back-relation `refreshTokens RefreshToken[]` to `model User`** — Prisma
fails validation with `P1012` without it.

Then `npm run db:migrate -- --name add_refresh_token`. Purely additive, no backfill.

**Why sha256 and not bcrypt** — put this in a comment, because a reviewer *will*
try to change it: the value must be looked up by equality on every refresh, so it
has to be indexable, which bcrypt's per-row salt makes impossible. sha256 is
correct *here specifically* because the token is 256 bits of `randomBytes` entropy,
not a guessable human password. Collision risk is ~10⁻⁵⁸; still catch `P2002` on
insert and map it to a system error — never to a retry loop.

**[Optional]** `familyExpiresAt` for an absolute session ceiling — see B6.

### B2 — Env **[Required]**

```diff
  JWT_EXPIRES_IN="7d"
+ REFRESH_TOKEN_EXPIRES_IN="30d"
```

in `.be.env` **and** the live `analyrics-be/.env`. `JWT_EXPIRES_IN` is already
`7d` and stays as-is. Add the matching Joi entry at the same time (P2).

Reference values, since they appear in tests and cookie `maxAge`:

| Value | ms |
|---|---|
| `7d` | `604_800_000` |
| `30d` | `2_592_000_000` |

### B3 — Duration + cookie helpers **[Required]**

**Modify** `src/auth/utils/jwt-expiry.util.ts` — add `parseDurationToMs(raw): number`
reusing `JWT_EXPIRES_IN_PATTERN`, so it cannot drift from `resolveJwtExpiresIn`.

> **Trap, already documented at lines 49-57 of that file:** for a bare number the
> regex leaves capture group 2 `undefined`. `ms` reads a unit-less *string* as
> **milliseconds**, but `jsonwebtoken` reads a bare *number* as **seconds**. So
> `JWT_EXPIRES_IN=3600` must yield `3_600_000`, not `3_600` — the opposite of `ms`'s
> own rule. Also `Math.round` the fractional-with-unit case (`'1.5h'`), which the
> regex permits.

**Create** `src/auth/utils/auth-cookies.util.ts` — the single source of cookie
truth, used by login / register / refresh / logout so the four can never drift:

```ts
export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/api/auth';

export function baseCookieOptions(isProd: boolean): CookieOptions {
  return isProd
    ? { httpOnly: true, secure: true,  sameSite: 'none', partitioned: true }
    : { httpOnly: true, secure: false, sameSite: 'lax' };
}
```

Plus `setAuthCookies()` / `clearAuthCookies()`.

- `partitioned: true` (CHIPS) **[Recommended]** — supported by Express 5 (verified:
  this repo is on `express@5.2.1`, `cookie@0.7.2`) and is what keeps a genuinely
  third-party cookie working as Chrome phases out unpartitioned 3P cookies.
- `maxAge` derived from the TTL env vars via `parseDurationToMs` — access cookie
  7d, refresh cookie 30d. This also removes a real hazard: the login cookie's
  `maxAge` is a hardcoded 7 days at `auth.controller.ts:54`, which *happens* to
  match `JWT_EXPIRES_IN` right now but is not derived from it, so changing the env
  var alone would silently desynchronise the cookie from the token it carries.
- **Clear must mirror set.** Browsers key deletion on name + domain + path, so the
  current clear at `path: '/'` (`auth.controller.ts:118-123`) would *never* delete
  a cookie set at `/api/auth` — the two would coexist. And in production a
  `Set-Cookie` carrying `SameSite=Lax` on a cross-site response is rejected
  outright, making the clear a silent no-op. Express 5's `clearCookie` ignores
  `maxAge`, so strip it on the clear path.
- `REFRESH_COOKIE_PATH` is correct given `setGlobalPrefix('api')` (`main.ts:20`).
  RFC 6265 path-matching means it also matches `/api/auth/…` but **not**
  `/api/authorize`. Keep it a shared constant, never an inline literal.

### B4 — Repository **[Required]**

**Modify** `src/auth/repositories/auth.repository.ts` + `.impl.ts`: add `findById`
(needed by B6's refresh path).

**Create** `src/auth/repositories/refresh-token.repository.ts` (+ `.impl.ts`),
mirroring the abstract-class-as-DI-token pattern: `issue`, `claimAndRotate`,
`findByHash`, `revokeFamily`, `markGraceUsed`, `deleteExpiredForUser`,
**[Optional]** `enforcePerUserCap` (revoke oldest beyond ~20 live).

**`claimAndRotate` is the security-critical one.** A plain `$transaction` at
PostgreSQL's default READ COMMITTED **does not** make "read row → write row"
atomic: two concurrent refreshes with the same cookie both read `revokedAt: null`,
both proceed, and you end up with two live children in one family. A transaction
gives all-or-nothing per branch, *not* mutual exclusion.

**Claim first, diagnose second** — make a conditional `updateMany` the mutex:

```ts
return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
  const claimed = await tx.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
    data:  { revokedAt: now, revokedReason: 'ROTATED' },
  });
  if (claimed.count === 0) return { outcome: 'NOT_CLAIMED' as const };
  // read the claimed row, insert the child in the same family, return both
}, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
     maxWait: 2_000, timeout: 5_000 });
```

`updateMany` with `revokedAt: null` in the `WHERE` **is** atomic under READ
COMMITTED — the second writer blocks on the row lock, then Postgres re-evaluates
the predicate against the committed new version and matches zero rows. Exactly one
caller ever gets `count === 1`. Only when the claim *loses* do you run the
grace/reuse diagnosis of B5.

> **Two Prisma-6 traps that collide with the house style.**
> **(1) Returning `Err` from inside an interactive transaction does not roll it
> back — only a thrown exception does.** Since `oxide.ts` `Result` is the convention
> everywhere, you need a private sentinel throw inside the callback and a `catch` at
> the repository boundary mapping to `Err('Hệ thống bị lỗi, vui lòng thử lại sau.')`.
> Get this wrong and a failed child insert leaves the parent revoked and the user
> hard-logged-out.
> **(2)** Type the callback param `Prisma.TransactionClient`. `.claude/rules/api-style.md`
> forbids `any`, and `tsconfig.json` has `noImplicitAny: false`, so an untyped `tx`
> would pass compilation silently.

### B5 — The refresh decision **[Required]**

**Create** `src/auth/utils/refresh-decision.util.ts` — the reject/grace/reuse state
machine as a **pure function** `(row | null, now, graceMs) → RefreshDecision`.
Extracting it is what makes the security logic testable without a database; do not
inline it in the service.

| Branch | HTTP | Clear cookies? | Revoke family? |
|---|---|---|---|
| no cookie | 401 | yes (harmless) | no |
| hash not found | 401 | yes | no (can't identify one) |
| expired | 401 | yes | no |
| revoked `ROTATED`, within grace, `graceUsedAt` null | 401 | **NO** | **no** |
| revoked, any other case | 401 | yes | **yes** + `Logger.warn` |

**The "clear cookies: NO" row is the single easiest bug to introduce.** The obvious
implementation — "any 401 from `/auth/refresh` → clear both cookies" — **destroys
the winner's freshly issued `refresh_token`** when the loser's response lands
second. The loser also needs a distinguishable signal (a `retryable: true` field
inside `data`) so the frontend retries instead of routing to sign-in.

**Why the grace window needs `revokedReason` and `graceUsedAt`, not just a
timestamp.** A time-only grace forgives *whoever loses the race, regardless of
identity*, which defeats reuse detection in exactly the scenario it exists for: an
attacker with a stolen token refreshes first, wins, and the victim's legitimate
replay is silently forgiven while the attacker keeps the family.

- `revokedReason` — grace applies **only** to `ROTATED`. Without it, a family just
  mass-revoked for `REUSE` has every row at `revokedAt ≈ now`, so for the next N
  seconds every replay in that dead family takes the grace path instead of being
  re-flagged.
- `graceUsedAt` — a revoked row may be forgiven **at most once**. This is what
  closes the attack above: the victim's *second* replay trips reuse detection and
  kills the family, so the attacker loses it too.
- Use a **5-second** window. The frontend single-flight (F3) already eliminates the
  same-browser race; the window only needs to cover multi-tab.

**[Optional] Client fingerprint.** Adding `clientFp` (`sha256(userAgent + ipPrefix)`)
and forgiving only a matching presenter would catch the attacker on the *first*
replay. Deferred because IP churn on mobile networks causes false positives, and a
false positive here means an unexplained logout.

There is currently **no `Logger` anywhere in `src/auth/`**. Reuse detection that
isn't logged is detection that doesn't exist — and at 7-day access tokens, the log
line may be the *only* signal you ever get.

### B6 — `AuthService` **[Required]**

Token: `randomBytes(32).toString('base64url')`, stored as
`createHash('sha256').update(token).digest('hex')`.

- **`login`** — verify password (unchanged), start a **new family**
  (`familyId = randomUUID()`), issue both tokens. Fire-and-forget
  `deleteExpiredForUser` with a swallowed rejection, so cleanup failure never
  fails a login.
- **`register`** — issue tokens too, so sign-up signs the user in. Note this is a
  real **signature change** (`Result<IUser, string>` → a login-shaped result), not
  a controller tweak. The response *body* contract is unchanged; only `Set-Cookie`
  is added. The alternative — frontend chains register → login — doubles the
  failure surface for no benefit.
- **`refresh`** — claim (B4), then diagnose (B5). **Must re-read the user from the
  DB and sign from current state.** `IJwtPayload` embeds `role`; copying claims
  from the old token would compound the staleness noted in §1 — a demoted user
  would keep `ADMIN` indefinitely rather than merely for the current access
  token's remaining life. Fail closed if the user row is gone.
- **`logout`** — revoke the presented token's **family only** (signs out this
  device, not the user's phone). Four details:
  - The lookup must **not** filter `revokedAt: null` — a user logging out right
    after a rotation presents a revoked-but-known token, and you still need its
    `familyId`.
  - Derive `familyId` from the looked-up row; **never** accept one from the request.
  - Must be **idempotent**: a missing or garbage cookie still returns 200 and still
    clears cookies, so a corrupt session is always escapable.
  - **Outstanding access tokens survive for up to 7 days** — see the callout in §1.
    Write this down in a code comment at the logout handler so the next reader does
    not assume logout is a full revocation.

**[Optional] Absolute session cap.** Rotation issues each child a fresh
`now + 30d`, so a user who refreshes every few weeks stays signed in forever and an
undetected stolen family is immortal. Carry `familyExpiresAt = issuedAt + 90d` and
clamp the child's `expiresAt` to `min(now + refreshTtl, familyExpiresAt)`. Cheap
now, needs a migration later.

### B7 — Guard, strategy, interfaces **[Required]**

**Modify** `src/auth/interfaces/jwt.interface.ts` — add **`exp?: number`** to
`IAuthUser`. It must be **optional**: `IJwtPayload.exp` is already optional, so
under `strictNullChecks` a required field is a compile error in
`JwtStrategy.validate`. No leak (it is already inside the JWT) and no break to
`GetCurrentUserId`, which reads `Partial<IAuthUser>` and touches only `userId`.
**Update the doc comment at lines 9-13 in the same commit** — it currently asserts
`IAuthUser` is the identity contract and not a claims bag, which `exp` makes false.

**Modify** `src/auth/strategies/jwt.strategy.ts:40-46` — map `exp`.

**Modify** `src/auth/guards/at.guard.ts`. `AtGuard` returns `null` for *any*
failure including `TokenExpiredError`, which means an expired token produces a
**200 OK where the user is silently downgraded to a guest** — history stops
recording, the response looks fine, and the frontend gets no 401 to react to.

At a 7-day access token this is rarer than it would have been at 15 minutes, but
it is not eliminated, and it is *harder* to notice precisely because it is rare:
the window it now lands in is a returning user whose access token expired while
their 30-day refresh token is still good — the single most common real-world
session. Emit an out-of-band signal:

```ts
handleRequest<TUser = IAuthUser>(err: unknown, user: TUser | false, info: unknown, ctx: ExecutionContext): TUser | null {
  if (info instanceof TokenExpiredError) {
    ctx.switchToHttp().getResponse<Response>().setHeader('X-Token-Expired', '1');
  }
  return err || !user ? null : user;
}
```

Drop both `any`s while here (`.claude/rules/api-style.md` forbids them). Pair with
`exposedHeaders` from P4.

### B8 — Controller, DTOs, module **[Required]**

| Route | Guard | Success payload |
|---|---|---|
| `POST /api/auth/login` | — | `{ user, accessTokenExpiresAt }` + both cookies |
| `POST /api/auth/register` | — | 201, same shape + both cookies |
| `POST /api/auth/refresh` | — (reads the cookie) | `{ user, accessTokenExpiresAt }` + rotated cookies |
| `POST /api/auth/logout` | — | non-null `data`, both cookies cleared |
| `GET /api/auth/me` | `AtGuard` | `{ user: UserData \| null, accessTokenExpiresAt: number \| null }` |

- **No endpoint may return a null `data`** — `apiFetch` throws on it
  (`src/lib/api.ts:132`). `/auth/me` returns `{ user: null }` for guests, never a
  bare `null`. Using the permissive `AtGuard` also gives guests a clean 200 instead
  of a 401 in the console on every page load.
- **`accessTokenExpiresAt`, not `…ExpiresIn`** — an absolute epoch **milliseconds**
  value (`exp * 1000`). A duration goes stale the moment the frontend caches it,
  and `exp` is in *seconds* while `Date.now()` is in *milliseconds*, which is a
  guaranteed ×1000 bug if the field isn't named for its unit.
- `@Throttle` on login / register / refresh — **not** on `/auth/me`, which every
  page load hits. New `LOGIN_*` / `REFRESH_*` constants in
  `src/shared/constants/throttle.ts`. Today these inherit the 60/min default, far
  too loose for a credential endpoint.
- **[Recommended]** `Cache-Control: no-store` on every `/auth/*` response.
- Swagger: add decorators to `register` and `logout` (currently bare) and
  `@ApiCookieAuth()` — `main.ts:36` advertises `.addBearerAuth()`, but the strategy
  only ever reads a cookie, so the Authorize button is misleading.
- `auth.module.ts`: register the new repository provider; add `exports: [AuthService]`.

---

## 4. Frontend

### F1 — Types **[Required]**

**Create** `src/types/auth/auth.interface.ts`: `IAuthUser`
(`{ id, name, email, role, created_at }` — mirror the backend's snake_case
`created_at` rather than silently renaming it), `IAuthSession`, `ILoginPayload`,
`IRegisterPayload`.

### F2 — `apiFetch` sibling for data-less responses **[Required]**

**Modify** `src/lib/api.ts`. Extract the shared body into an internal function
parameterised by whether `data` is required, then export the existing `apiFetch`
(behaviour **byte-identical** for its three current call sites) plus a new
`apiFetchVoid` for logout. This follows the instruction the file already gives
itself at lines 129-131. **Do not weaken `apiFetch`'s guard.**

**[Recommended]** Also handle the `X-Token-Expired` header here: single-flight a
`/auth/refresh` and replay the request once. With a 7-day access token this is the
path that will actually catch expiry in practice, since the F4 timer rarely fires.

### F3 — Auth API layer **[Required]**

**Create** `src/lib/auth-api.ts`: `login`, `register`, `logout`, `fetchSession`,
`refreshSession`.

This module owns a **module-level in-flight refresh promise**:

```ts
let inFlightRefresh: Promise<IAuthSession> | null = null;
```

Without it, two components mounting at once — or React StrictMode's double-mount
in dev — fire two rotations, one loses, and the loser's 401 is indistinguishable
from a real reuse attack. The backend grace window (B5) is the second layer, for
the multi-tab case this cannot cover.

### F4 — `AuthProvider` + `useAuth` **[Required]**

**Create** `src/components/auth/authProvider.tsx` (`'use client'`), exporting both
the provider and a `useAuth` hook that throws outside it.

State `{ user, status: 'loading' | 'authenticated' | 'guest' }`; actions `signIn`,
`signUp`, `signOut`.

**Bootstrap — the primary refresh path.** `GET /auth/me` → if a user,
authenticated. If `user: null`, attempt `POST /auth/refresh` (the 7-day access
cookie has expired but the 30-day refresh cookie is still valid). Refresh fails →
guest.

At these lifetimes **bootstrap is where refresh almost always happens.** A 7-day
access token means a normal user's token expires between visits, not during one.
Get this path right first; the timer below is the edge case, not the main event.

**Silent refresh timer [Recommended].** Schedule against
`accessTokenExpiresAt - 60s`, floored at ~30s. Re-schedule after each success;
clear on unmount and sign-out. Also refresh on `visibilitychange` when a tab
becomes visible — a laptop waking from sleep has a dead timer.

> **`setTimeout` overflow — a real trap at these values.** `setTimeout` stores its
> delay in a signed 32-bit int, so anything above **2 147 483 647 ms (≈24.86 days)**
> overflows and **fires immediately**. A 7-day access token (604 800 000 ms) is
> safely under that, but 30 days (2 592 000 000 ms) is **not** — so any timer
> scheduled from the *refresh* token's lifetime would fire instantly and hammer
> `/auth/refresh` in a loop. Clamp every computed delay to a sane ceiling
> (e.g. `Math.min(delay, 24 * 60 * 60 * 1000)`) and re-arm, rather than trusting
> the arithmetic.

### F5 — Mount the provider **[Required]**

**Modify** `src/app/layout.tsx`: wrap `{children}` in `<AuthProvider>`. The layout
stays a server component; the provider carries `'use client'`. This is the app's
first provider — there is no provider tree today.

### F6 — Modal shell **[Required]**

**Create** `src/components/auth/authModal.tsx`. No dialog/dropdown component exists
anywhere, so this is from scratch:

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby`.
- Focus trap; focus the first field on open; **restore focus to the trigger on close**.
- Escape closes; backdrop click closes; lock body scroll while open.
- Backdrop `bg-black/70 backdrop-blur`; panel from the `songCard.tsx` glass pattern;
  animated with `scaleIn` inside `AnimatePresence` (it already defines
  `hidden`/`visible`/`exit`, so no extra props). Respect the standing rule at
  `src/lib/motion.ts:7-11` — animate **only** opacity and transform; keep
  `backdrop-blur` a static class.
- Tabs switch `Đăng nhập` / `Đăng ký`; the caller sets the initial tab so each
  navbar button opens the right one.

### F7 — Forms **[Required]**

**Create** `src/components/auth/loginForm.tsx` and `registerForm.tsx`. No
react-hook-form and no zod are installed, and this plan does not add them for two
small forms — plain controlled `useState`, matching `searchBar.tsx`.

Mirror `auth.dto.ts` exactly (email format, password `MinLength(6)`, name
non-empty) for fast feedback; the backend stays the authority. Render
`ApiError.message` inline — the backend already returns display-ready Vietnamese
and `apiFetch` surfaces it verbatim.

Accessibility: a real `<label>` per field (note `searchBar.tsx` has none — do not
copy that), `aria-invalid`, `aria-describedby` → error node, `role="alert"` on the
form-level error, disabled submit + spinner while pending,
`autoComplete="email" / "current-password" / "new-password"`.

**Two backend quirks to handle:** the global pipe uses `forbidNonWhitelisted: true`,
so posting any undeclared field is a hard 400; and a pipe rejection bypasses the
app envelope entirely, returning Nest's default shape where **`message` is a string
array**. Tolerate both rather than rendering `[object Object]`.

### F8 — User menu **[Required]**

**Create** `src/components/auth/userMenu.tsx`: name button → dropdown with email +
`Đăng xuất`. Needs `aria-expanded`, `aria-haspopup`, Escape-to-close, and
click-outside-to-close.

### F9 — Wire the navbar **[Required]**

**Modify** `src/components/dashboard/navBar.tsx` — the visible payoff:

- Delete `const user = { name: "Khách" }` (line 10); read `useAuth()`.
- `loading` → a small skeleton, so the navbar does not flash `Đăng nhập` and then
  snap to the user's name on every page load.
- `authenticated` → `<UserMenu />`. `guest` → the two existing buttons, now with
  `onClick` opening the modal on the matching tab. Their markup at lines 24-27 is
  reusable as-is.

**Known limitation, accepted:** `Navbar` renders only inside the `dashboard` branch
of `renderView()` (`homeContainer.tsx:139`), so sign-out is reachable only from the
dashboard. Hoisting it would change the layout of three other views; left alone
deliberately.

---

## 5. Task order

### Pre-flight

Both repos have dirty working trees. As of now, in `analyrics-be`: the §0 changes
to `package.json` and `app.module.ts`, plus pre-existing definite-assignment
assertions (`id!: string`) in `auth.dto.ts` / `analysis.dto.ts` /
`baseResponse.ts`, a stricter `tsconfig.json`, and a deleted
`analysis.service.spec.ts`. In `analyrics-fe`: the §0 `quoteSection.tsx` fix plus
edits to `homeContainer.tsx` and `navBar.tsx`.

`auth.dto.ts` (B8) and `navBar.tsx` (F9) are both already modified, though only
cosmetically. Commit or stash before starting so the auth commits stay atomic.

### Then

1. **Phase 0** — P1 `trust proxy`, P4 `exposedHeaders`. *(P2 partly done; P3 CSRF
   middleware can land with B8 but must not ship after it.)*
2. B1 model + migration → B2 env + the `REFRESH_TOKEN_EXPIRES_IN` Joi entry
3. B3 utils (pure, testable, zero DI) → B5 decision function
4. B4 repositories → B6 service → B7 guard/strategy → B8 controller
5. **Backend tests (§6), then verify with curl before touching the frontend**
6. F1 → F2 → F3 → F4 → F5
7. F6 → F7 → F8 → F9

`analyrics-be` and `analyrics-fe` are **two independent git repositories** (the
parent folder is not a repo), so backend and frontend cannot land as one atomic
change. Deploy the backend first. Per the commit policy, do not commit without an
explicit request.

---

## 6. Verification

### Automated (backend)

The repo has **zero** auth tests — `auth.controller.spec.ts` and
`auth.service.spec.ts` were deleted in commit `e4b02db`. Jest `rootDir` is `src`,
`testRegex: .*\.spec\.ts$`; e2e is `test/*.e2e-spec.ts`.

**Pure units — best value per effort, no DI:**

- `jwt-expiry.util.spec.ts` — `parseDurationToMs('3600') === 3_600_000` (the
  inverted-`ms` trap), `'7d'` → `604_800_000`, `'30d'` → `2_592_000_000`, `'1.5h'`
  → `5_400_000`; tab / non-breaking-space separators rejected.
- `auth-cookies.util.spec.ts` — prod → `sameSite:'none', secure:true`; dev → `lax`;
  **set and clear options attribute-identical except `maxAge`**; refresh path is
  exactly `/api/auth`; access `maxAge` is 7d and refresh `maxAge` is 30d, both
  derived from env rather than literals.
- `refresh-decision.util.spec.ts` — the security core:
  not found → reject; valid → rotate; expired → reject;
  revoked 3s ago as `ROTATED` → **grace, `clearCookies === false`**;
  revoked 30s ago → reuse; revoked 3s ago with reason `REUSE` → reuse, never grace;
  revoked 3s ago with `graceUsedAt` set → reuse; and the exact-boundary case.

**Service (mocked repos):** refresh signs the **current** role, not the old token's;
refresh with a deleted user → `Err` + family revoked; reuse calls `revokeFamily`
exactly once and logs; login cleanup rejection does not fail login.

**Guard:** `TokenExpiredError` → `null` **and** `X-Token-Expired` set; malformed
token → `null`, no header; `GetCurrentUserId` still returns `null`.

**Integration (real Postgres — this is where the B4 race lives) [Recommended]:**
fire 20 parallel `claimAndRotate` calls with the same hash → exactly **one**
`count === 1` and exactly **one** child row. This fails without the conditional
`updateMany`. Also: a failed child insert rolls back the parent revoke.

**E2E `test/auth.e2e-spec.ts`** (supertest + cookie jar; build the app with
`VALIDATION_PIPE_OPTIONS` **and** `setGlobalPrefix('api')` so paths match prod):
`register → me → logout → me(null) → login → refresh → me`; the refresh cookie
carries `Path=/api/auth`; replaying the pre-rotation token 401s and kills the
family; `/auth/me` as a guest is **200 with non-null `data`**; logout with no
cookie is 200; `POST /analysis/analyze` with an expired token is **200 with
`X-Token-Expired: 1`**.

Run: `npm test`, `npm run test:e2e`, `npm run build`, `npm run lint`.

### Manual (full stack)

Backend `npm run start:dev` (:3001), frontend `npm run dev` (:3000).

Because the real TTLs are now 7d/30d, **most session behaviour cannot be observed
by waiting.** Test it by temporarily setting `JWT_EXPIRES_IN=1m` and
`REFRESH_TOKEN_EXPIRES_IN=5m`, running checks 5–7 and 9, then restoring 7d/30d and
re-running 1–3 to confirm the real values still work.

1. **Register** → modal closes, navbar shows the name with no second step. DevTools
   → Cookies: `access_token` (7d) **and** `refresh_token` (30d, `Path=/api/auth`),
   both `HttpOnly`.
2. **Reload** → name persists (proves `/auth/me`).
3. **Sign out** → buttons return, **both** cookies gone, no console error.
4. **Wrong password / duplicate email** → inline Vietnamese error, modal stays open.
5. **Bootstrap refresh (the main path)** → delete only `access_token`, reload.
   Expect `/auth/me` → null, an automatic `/auth/refresh`, session restored.
6. **Rotation** → with the short TTLs, expect exactly one `/auth/refresh` and a
   changed `refresh_token` value.
7. **Reuse detection** → copy the refresh cookie, trigger a refresh, then `curl`
   with the **old** value → 401, family dead, `Logger.warn` in the server log.
8. **Guest regression (the most important check)** → private window, no sign-in:
   search, analyze, and trending must all work exactly as before.
9. **Two tabs** → force a refresh in both at once; neither is signed out.
10. **Keyboard-only modal** → Tab cycles inside, Escape closes, focus returns to
    the trigger.
11. **Production smoke, after deploy** → sign in on the real domain pair
    (`analyrics-nine.vercel.app` ↔ `analyrics-be.onrender.com`) and confirm the
    cookie is actually *sent* on a subsequent request. This is the one failure that
    cannot reproduce locally (§1.3).

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| **Production cookies dropped** — `SameSite=Lax` cross-site. Works locally, fails in prod: the worst failure shape. | B3 sets `SameSite=None; Secure` (+ `partitioned`). Manual check 11 on a real deploy. |
| **Sign-out leaves a valid access token for up to 7 days.** | Accepted; documented in §1 and at the logout handler. Mitigations offered (shorter access TTL, or `tokenVersion`) if unacceptable. |
| **Double rotation** — `$transaction` is not a mutex under READ COMMITTED. | B4 conditional `updateMany`. Integration test with 20 parallel calls. |
| **Grace window forgives the attacker** and reuse detection never fires. | B5 `revokedReason` + one-shot `graceUsedAt`. |
| **The loser's 401 clears the winner's fresh cookie.** | B5 branch table; the grace branch must not clear. |
| **`setTimeout` overflow at 30d** → immediate fire → refresh loop. | F4 clamp every delay to ≤24h and re-arm. |
| **429 storm reading as mass logout** — one shared throttle bucket behind the proxy. | P1 `trust proxy` before any auth throttling ships; no throttle on `/auth/me`. |
| **CSRF**, newly opened by `SameSite=None`. | P3 Origin-check middleware. |
| **Stale `role`** for the life of the access token (now up to 7 days). | B6 refresh re-reads the user; §1 documents the residual window. |
| **Silent guest downgrade** with no 401 anywhere. | B7 `X-Token-Expired` + P4 `exposedHeaders` + F4 bootstrap refresh. |
| `Err` inside a Prisma transaction does not roll back. | B4 sentinel throw + boundary catch. |
| Guest regression on `/analysis/analyze`. | `AtGuard`/`GetCurrentUserId` contracts unchanged. Manual check 8. |

---

## 8. Deliberately out of scope

Real issues found while planning; none are fixed here.

- **`.be.env` holds live secrets in plaintext** — `JWT_SECRET`,
  `SPOTIFY_CLIENT_SECRET`, a Gemini key, a Neon URL. It sits at
  `D:\Palsoner\Tech\analyrics\`, which is **not** a git repo, so it is not in any
  history — but it must never be moved *into* either repo.
  `analyrics-be/.gitignore:42` correctly ignores `.env`. Since §1.3 means there are
  no live prod sessions, this is a free moment to rotate `JWT_SECRET`.
- **`main.ts:17` reads `PORT`; `.be.env` defines `BE_PORT`** — the lookup always
  misses and falls back to 3001. (The live `.env` does define `PORT`, so this bites
  only a fresh setup copied from `.be.env`.)
- **`RegisterDto.phone`** is validated but has no column and is silently dropped.
- **No strict 401 guard.** Not needed given "nothing becomes required", but a
  `JwtAuthGuard` is the first thing any future protected route will want, and
  splitting it would make silent downgrade opt-in rather than the default.
- **`POST /auth/logout-all`** and password-change-revokes-everything — the natural
  home for `tokenVersion` if the §1 trade-off is ever revisited.
- **`UserHistory` remains write-only** — no read endpoint, no UI.
- **No frontend test runner.** Frontend verification here is manual.
- **`@nestjs/cli`, `@nestjs/schematics`, `ts-loader`, `typescript` sit in
  `dependencies`** rather than `devDependencies`. Harmless but inflates the
  production install; left alone since §0 already touched this file.
