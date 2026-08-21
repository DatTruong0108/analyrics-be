export interface IJwtPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

/**
 * Shape attached to `request.user` once the 'jwt' strategy has validated a
 * token. This is the single contract consumers such as GetCurrentUserId
 * read from — the raw `sub` claim does not leak past the strategy.
 */
export interface IAuthUser {
  userId: string;
  email: string;
  role: string;
}
