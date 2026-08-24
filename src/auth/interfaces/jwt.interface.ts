export interface IJwtPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

/**
 * Shape attached to `request.user` once the 'jwt' strategy has validated a
 * token. This is the single contract consumers such as GetCurrentUserId read
 * from — the raw `sub` claim does not leak past the strategy.
 *
 * Mostly identity, but `exp` is carried through as well so `/auth/me` can tell
 * the client when the current access token dies without re-parsing the cookie.
 * That is a claim, not an identity field, so treat this as "what the validated
 * token told us about the caller" rather than a pure identity record.
 */
export interface IAuthUser {
  userId: string;
  email: string;
  role: string;
  /**
   * Expiry claim in **seconds**, as JWTs count it — multiply by 1000 before
   * comparing against `Date.now()`.
   *
   * Optional because `IJwtPayload.exp` is: under `strictNullChecks` a required
   * field here would not compile in `JwtStrategy.validate`. In practice it is
   * always present, since the signing options always set an expiry.
   */
  exp?: number;
}
