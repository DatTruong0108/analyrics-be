export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

export interface IUser {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  role: string;
  password?: string;
}

export interface ILoginResult {
  user: IUser;
  accessToken: string;
}

/**
 * What a successful authentication hands back — login, register and refresh all
 * return this same shape, so a signed-in session is constructed exactly one way
 * no matter which door the user came through.
 */
export interface IAuthSession {
  user: IUser;
  accessToken: string;
  /**
   * Plaintext opaque refresh token. Exists only long enough to reach the
   * `Set-Cookie` header — only its sha256 is ever persisted.
   */
  refreshToken: string;
  /**
   * Absolute epoch **milliseconds** at which `accessToken` expires, read back
   * off the signed JWT rather than recomputed, so it cannot disagree with the
   * `exp` the token actually carries.
   */
  accessTokenExpiresAt: number;
}

/**
 * Why a refresh failed, and what the caller must do about it.
 *
 * Structured rather than the house `Result<_, string>` on purpose: the refresh
 * responses differ in more than their message. The grace branch in particular
 * must *not* clear cookies, and the client needs to know it should retry — both
 * of which a bare string would force the controller to infer by matching on
 * message text.
 */
export interface IRefreshFailure {
  /**
   * What went wrong, at the granularity the transport actually needs.
   *
   * `clearCookies` and `retryable` alone cannot separate "lost a rotation race"
   * from "the database is down" — both are retryable and both must leave
   * cookies intact — yet one is a 401 about the token and the other is a 500
   * about the server. Conflating them would bury infrastructure failures in the
   * 401 count and make them invisible in monitoring.
   */
  kind: 'INVALID' | 'RACE' | 'SYSTEM';
  message: string;
  clearCookies: boolean;
  retryable: boolean;
}
