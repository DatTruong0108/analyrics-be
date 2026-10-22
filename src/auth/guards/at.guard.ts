/* System Package */
import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TokenExpiredError } from '@nestjs/jwt';
import { Response } from 'express';

/* Application Package */
import { IAuthUser } from '../interfaces/jwt.interface';

/**
 * Permissive JWT guard: a failed or absent token makes the caller a guest
 * rather than producing a 401, so routes that serve both guests and members
 * (`/auth/me`, analysis reads) stay a single handler.
 */
@Injectable()
export class AtGuard extends AuthGuard('jwt') {
  /**
   * Downgrades any authentication failure to "guest", with one addition.
   *
   * Returning `null` for *every* failure means an **expired** token produces a
   * perfectly normal 200 in which the user has silently become anonymous —
   * history stops recording, nothing looks broken, and the client gets no 401
   * to react to. With a 7-day access token that is rare, which makes it harder
   * to notice, not easier: the window it lands in is a returning user whose
   * access token has lapsed while their 30-day refresh token is still good,
   * which is the single most common real session there is.
   *
   * So the failure stays permissive, but expiry is announced out of band via a
   * response header. The client reads it as "refresh, then retry" instead of
   * mistaking a lapsed session for a signed-out one. The header is only
   * readable cross-origin because `main.ts` lists it in `exposedHeaders`.
   *
   * Types are narrowed from Passport's `any` on purpose — `err` and `info` are
   * only ever inspected, never trusted.
   */
  handleRequest<TUser = IAuthUser>(
    err: Error | null,
    user: TUser | false,
    info: Error | undefined,
    context: ExecutionContext,
  ): TUser | null {
    if (info instanceof TokenExpiredError) {
      context
        .switchToHttp()
        .getResponse<Response>()
        .setHeader('X-Token-Expired', '1');
    }

    // Still null, never a throw: the caller is a guest, not an error.
    if (err || !user) return null;

    return user;
  }
}
