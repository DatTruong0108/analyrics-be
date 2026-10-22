/* System Package */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';

/**
 * Stamps `Cache-Control: no-store` on every response from the controller it is
 * applied to.
 *
 * Auth responses carry the user's identity and, on login/refresh, arrive
 * alongside `Set-Cookie`. Anything cached — a shared proxy, the browser's own
 * back/forward store — risks handing one person's profile to the next, and a
 * cached `/auth/me` would keep reporting a signed-in user after logout.
 *
 * Implemented as an interceptor rather than `@Header()` on each route for two
 * reasons: these handlers inject `@Res()`, which takes Nest out of the response
 * pipeline so `@Header()` never applies; and a controller-wide interceptor
 * covers routes added later, which a per-route decorator would not.
 *
 * The header is set before `next.handle()` runs, so it lands even though the
 * handlers write to the response themselves.
 */
@Injectable()
export class NoStoreInterceptor<T> implements NestInterceptor<T, T> {
  // Generic rather than `unknown`/`any`: this interceptor never inspects the
  // payload, and `.claude/rules/api-style.md` forbids both.
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<T> {
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');

    return next.handle();
  }
}
