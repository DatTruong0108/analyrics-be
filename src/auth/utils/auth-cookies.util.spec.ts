/* System Package */
import { CookieOptions } from 'express';

/* Application Package */
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  baseCookieOptions,
  setAuthCookies,
  clearAuthCookies,
} from './auth-cookies.util';

interface CookieCall {
  name: string;
  value?: string;
  options: CookieOptions;
}

/**
 * Structural stand-in for the bits of `express.Response` the helpers touch.
 * Recording the calls is the only way to assert on cookie *attributes* —
 * the thing that actually decides whether a browser stores or drops them.
 */
class RecordingResponse {
  readonly set: CookieCall[] = [];
  readonly cleared: CookieCall[] = [];

  cookie(name: string, value: string, options: CookieOptions): void {
    this.set.push({ name, value, options });
  }

  clearCookie(name: string, options: CookieOptions): void {
    this.cleared.push({ name, options });
  }

  find(name: string): CookieOptions {
    const hit = this.set.find((c) => c.name === name);
    if (!hit) throw new Error(`cookie '${name}' was never set`);
    return hit.options;
  }

  findCleared(name: string): CookieOptions {
    const hit = this.cleared.find((c) => c.name === name);
    if (!hit) throw new Error(`cookie '${name}' was never cleared`);
    return hit.options;
  }
}

const TOKENS = { accessToken: 'access.jwt.value', refreshToken: 'refresh-opaque' };

describe('auth cookie helpers', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // The helpers derive `maxAge` from these, and Joi guarantees both are
    // present and parsable at boot — so the tests must supply them too.
    process.env = { ...originalEnv, JWT_EXPIRES_IN: '7d', REFRESH_TOKEN_EXPIRES_IN: '30d' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('baseCookieOptions', () => {
    /*
     * Production is cross-site: the API and the frontend are on different
     * registrable domains, so the cookie is third-party. `SameSite=None`
     * is the only value a browser will send cross-site, and it is invalid
     * without `Secure`. Getting either wrong means the cookie is dropped
     * silently and the user simply appears logged out.
     */
    it('is cross-site capable in production', () => {
      const opts = baseCookieOptions(true);
      expect(opts.sameSite).toBe('none');
      expect(opts.secure).toBe(true);
      expect(opts.httpOnly).toBe(true);
      // CHIPS: survives Chrome's phase-out of unpartitioned third-party cookies.
      expect(opts.partitioned).toBe(true);
    });

    /*
     * Locally the frontend is same-site on localhost, so `None` would demand
     * `Secure`, which a plain-http dev server cannot satisfy — the cookie
     * would never be stored at all.
     */
    it('falls back to lax over plain http in development', () => {
      const opts = baseCookieOptions(false);
      expect(opts.sameSite).toBe('lax');
      expect(opts.secure).toBe(false);
      expect(opts.httpOnly).toBe(true);
    });
  });

  describe('setAuthCookies', () => {
    it('scopes the refresh cookie to exactly the auth prefix', () => {
      const res = new RecordingResponse();
      setAuthCookies(res, TOKENS, true);

      // Not '/', and not an inline literal anywhere: RFC 6265 path-matching
      // means this covers /api/auth/... while excluding /api/authorize.
      expect(REFRESH_COOKIE_PATH).toBe('/api/auth');
      expect(res.find(REFRESH_COOKIE).path).toBe('/api/auth');
      // The access cookie is read by every route, so it stays site-wide.
      expect(res.find(ACCESS_COOKIE).path).toBe('/');
    });

    it('writes both tokens under the shared cookie names', () => {
      const res = new RecordingResponse();
      setAuthCookies(res, TOKENS, true);

      expect(res.set.map((c) => c.name).sort()).toEqual(
        [ACCESS_COOKIE, REFRESH_COOKIE].sort(),
      );
      expect(res.set.find((c) => c.name === ACCESS_COOKIE)?.value).toBe(TOKENS.accessToken);
      expect(res.set.find((c) => c.name === REFRESH_COOKIE)?.value).toBe(TOKENS.refreshToken);
    });

    /*
     * The hazard this whole module exists to remove: the old controller hard-coded
     * `maxAge: 7 * 24 * 60 * 60 * 1000`, which merely *happened* to match
     * JWT_EXPIRES_IN. Changing the env var alone desynchronised the cookie from
     * the token it carried. Proven by moving the env, not by matching a literal.
     */
    it('derives maxAge from the TTL env vars rather than a literal', () => {
      const res = new RecordingResponse();
      setAuthCookies(res, TOKENS, true);
      expect(res.find(ACCESS_COOKIE).maxAge).toBe(604_800_000);
      expect(res.find(REFRESH_COOKIE).maxAge).toBe(2_592_000_000);

      process.env.JWT_EXPIRES_IN = '15m';
      process.env.REFRESH_TOKEN_EXPIRES_IN = '1d';
      const moved = new RecordingResponse();
      setAuthCookies(moved, TOKENS, true);
      expect(moved.find(ACCESS_COOKIE).maxAge).toBe(900_000);
      expect(moved.find(REFRESH_COOKIE).maxAge).toBe(86_400_000);
    });
  });

  describe('clearAuthCookies mirrors setAuthCookies', () => {
    /*
     * The single most important property in this file. Browsers key deletion on
     * name + domain + path, so a clear at '/' can never delete a cookie set at
     * '/api/auth' — the two would coexist and logout would silently not log out.
     * In production a Set-Cookie carrying SameSite=Lax on a cross-site response
     * is rejected outright, making the clear a no-op as well.
     *
     * Asserted as whole-object equality on purpose: a per-attribute check would
     * pass right up until someone adds a sixth attribute to only one of the two
     * paths, which is exactly how these drift.
     */
    it.each([
      ['production', true],
      ['development', false],
    ])('is attribute-identical except maxAge in %s', (_label, isProd) => {
      const res = new RecordingResponse();
      setAuthCookies(res, TOKENS, isProd);
      clearAuthCookies(res, isProd);

      for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
        const { maxAge, ...setRest } = res.find(name);
        expect(maxAge).toBeGreaterThan(0);
        expect(res.findCleared(name)).toEqual(setRest);
      }
    });

    // Express 5's clearCookie discards maxAge anyway; omitting it keeps the
    // two option objects honestly comparable instead of accidentally equal.
    it('omits maxAge on the clear path', () => {
      const res = new RecordingResponse();
      clearAuthCookies(res, true);

      for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
        expect(res.findCleared(name)).not.toHaveProperty('maxAge');
      }
    });

    it('clears both cookies, not just the access one', () => {
      const res = new RecordingResponse();
      clearAuthCookies(res, true);
      expect(res.cleared.map((c) => c.name).sort()).toEqual(
        [ACCESS_COOKIE, REFRESH_COOKIE].sort(),
      );
    });
  });
});
