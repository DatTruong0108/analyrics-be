/* System Package */
import { CookieOptions } from 'express';

/* Application Package */
import { parseDurationToMs } from './jwt-expiry.util';

/**
 * The single source of cookie truth for login / register / refresh / logout.
 *
 * All four write or erase the same two cookies, and a browser keys deletion on
 * name + domain + path — so any attribute that differs between the set path and
 * the clear path produces a cookie that cannot be deleted, only shadowed. Four
 * hand-rolled copies of these attributes is four chances to drift; this module
 * exists so there is exactly one.
 */

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';

/**
 * Scope of the refresh cookie. Correct given `setGlobalPrefix('api')`: the
 * refresh token is only ever presented to `/api/auth/refresh`, so keeping it
 * off every other route means an XSS-adjacent leak of one request's headers
 * cannot walk away with the long-lived credential.
 *
 * RFC 6265 path-matching makes this cover `/api/auth/…` while *not* matching
 * `/api/authorize`. Kept a shared constant precisely because set and clear
 * must agree on it character for character.
 */
export const REFRESH_COOKIE_PATH = '/api/auth';

/** The access token is read by every route, so it stays site-wide. */
export const ACCESS_COOKIE_PATH = '/';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * The slice of `express.Response` these helpers touch. Narrowed on purpose:
 * `Response` is structurally assignable to it, and it keeps the helpers
 * unit-testable without constructing an HTTP server or reaching for `any`.
 */
export interface AuthCookieResponse {
  cookie(name: string, value: string, options: CookieOptions): void;
  clearCookie(name: string, options: CookieOptions): void;
}

/**
 * Attributes shared by both auth cookies, in both directions.
 *
 * Production is genuinely cross-site — API and frontend sit on different
 * registrable domains — so `SameSite=None` is the only value a browser will
 * send along, and it is invalid without `Secure`. `partitioned` (CHIPS) keeps
 * the cookie working as Chrome phases out unpartitioned third-party cookies.
 *
 * Development cannot use that combination at all: `None` requires `Secure`,
 * which a plain-http dev server cannot offer, so the cookie would simply never
 * be stored. `lax` is right there because localhost is same-site anyway.
 */
export function baseCookieOptions(isProd: boolean): CookieOptions {
  return isProd
    ? { httpOnly: true, secure: true, sameSite: 'none', partitioned: true }
    : { httpOnly: true, secure: false, sameSite: 'lax' };
}

interface CookieSpec {
  name: string;
  /** Everything except `maxAge` — i.e. exactly what deletion matches on. */
  options: CookieOptions;
  /** Read lazily: env is validated at boot, but tests move it per case. */
  maxAgeMs: () => number;
}

/*
 * One list, two consumers. `setAuthCookies` spreads `maxAge` on top of
 * `options`; `clearAuthCookies` uses `options` as-is. That makes "clear mirrors
 * set on every attribute except maxAge" true by construction rather than by
 * remembering to edit two functions in step.
 */
function cookieSpecs(isProd: boolean): CookieSpec[] {
  const base = baseCookieOptions(isProd);

  return [
    {
      name: ACCESS_COOKIE,
      options: { ...base, path: ACCESS_COOKIE_PATH },
      /*
       * Derived from the env var, never a literal. The previous controller
       * hard-coded 7 days, which merely *happened* to equal JWT_EXPIRES_IN:
       * changing the env alone would have left the cookie outliving the token
       * inside it, so the browser would keep sending a credential the server
       * had already stopped honouring.
       */
      maxAgeMs: () => parseDurationToMs(process.env.JWT_EXPIRES_IN),
    },
    {
      name: REFRESH_COOKIE,
      options: { ...base, path: REFRESH_COOKIE_PATH },
      maxAgeMs: () => parseDurationToMs(process.env.REFRESH_TOKEN_EXPIRES_IN),
    },
  ];
}

/** Issues both auth cookies. Values must already be the final token strings. */
export function setAuthCookies(
  res: AuthCookieResponse,
  tokens: AuthTokens,
  isProd: boolean,
): void {
  const values: Record<string, string> = {
    [ACCESS_COOKIE]: tokens.accessToken,
    [REFRESH_COOKIE]: tokens.refreshToken,
  };

  for (const spec of cookieSpecs(isProd)) {
    res.cookie(spec.name, values[spec.name], {
      ...spec.options,
      maxAge: spec.maxAgeMs(),
    });
  }
}

/**
 * Erases both auth cookies.
 *
 * `maxAge` is deliberately absent: Express 5's `clearCookie` discards it and
 * forces `Expires=Thu, 01 Jan 1970` regardless, so passing it would only make
 * the set and clear option objects look different than they behave.
 */
export function clearAuthCookies(res: AuthCookieResponse, isProd: boolean): void {
  for (const spec of cookieSpecs(isProd)) {
    res.clearCookie(spec.name, spec.options);
  }
}
