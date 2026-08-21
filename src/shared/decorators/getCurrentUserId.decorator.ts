/* System Package */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/* Application Package */
import { IAuthUser } from 'src/auth/interfaces/jwt.interface';

/**
 * Reads the caller id off `request.user` as populated by JwtStrategy.
 *
 * Returns null — never an empty string and never a non-string — for anonymous
 * callers, so the absence of a user stays distinguishable from a real id.
 * The shape is checked rather than asserted: AtGuard lets unauthenticated
 * requests through, so anything that drifts here would otherwise reach Prisma
 * unvalidated and fail silently.
 */
export const GetCurrentUserId = createParamDecorator(
  (_: undefined, context: ExecutionContext): string | null => {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as Partial<IAuthUser> | undefined | null;
    const userId = user?.userId;

    return typeof userId === 'string' && userId.length > 0 ? userId : null;
  },
);
