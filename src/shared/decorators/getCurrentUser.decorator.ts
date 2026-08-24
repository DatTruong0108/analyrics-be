/* System Package */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/* Application Package */
import { IAuthUser } from 'src/auth/interfaces/jwt.interface';

/**
 * Reads the whole validated caller off `request.user`, as populated by
 * JwtStrategy — a sibling of GetCurrentUserId for routes that need more than
 * the id, such as `/auth/me` reporting the access token's `exp`.
 *
 * Returns null for anonymous callers. AtGuard deliberately lets unauthenticated
 * requests through, so the shape is validated rather than asserted: `userId` is
 * required to be a non-empty string before anything is handed back, which keeps
 * a malformed `request.user` from being mistaken for a signed-in user.
 */
export const GetCurrentUser = createParamDecorator(
  (_: undefined, context: ExecutionContext): IAuthUser | null => {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as Partial<IAuthUser> | undefined | null;

    if (typeof user?.userId !== 'string' || user.userId.length === 0) {
      return null;
    }

    return {
      userId: user.userId,
      email: typeof user.email === 'string' ? user.email : '',
      role: typeof user.role === 'string' ? user.role : '',
      exp: typeof user.exp === 'number' ? user.exp : undefined,
    };
  },
);
