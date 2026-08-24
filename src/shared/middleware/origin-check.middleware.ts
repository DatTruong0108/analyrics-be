/* System Package */
import { ForbiddenException, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';

/* Application Package */
import { resolveAllowedOrigins } from '../config/allowed-origins';

/**
 * Methods that can change server state, and therefore the only ones worth
 * protecting. `GET`/`HEAD` are left alone because they must stay cacheable and
 * link-followable, and `OPTIONS` must pass untouched or every CORS preflight
 * would fail before the real request was ever made.
 */
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const FORBIDDEN_MESSAGE = 'Yêu cầu bị từ chối: nguồn gửi không được phép.';

/**
 * Origin-based CSRF protection.
 *
 * Until now `sameSite: 'lax'` was blocking cross-site cookie traffic, which
 * incidentally prevented CSRF — by breaking authentication entirely. Moving to
 * `SameSite=None` (unavoidable: the API and frontend are on different
 * registrable domains) removes that accident, and with it the only thing
 * stopping an attacker's page from calling
 * `fetch('…/api/analysis/analyze', { credentials: 'include' })` to spend the
 * victim's Gemini quota, or hitting `/api/auth/refresh` to force a rotation.
 *
 * Note that scoping the refresh cookie to `/api/auth` does **not** protect
 * `/api/auth/refresh` itself — that path is exactly where the cookie is sent.
 *
 * The check is cheap because an allowlist already exists for CORS: reuse it,
 * and reject state-changing requests that did not come from it. No CSRF tokens,
 * no session plumbing, no frontend change.
 *
 * Why `Origin` is trustworthy here: it is a forbidden header name, so page
 * JavaScript cannot set or suppress it. An attacker page can send the victim's
 * cookies but cannot make the browser lie about who sent the request.
 */
@Injectable()
export class OriginCheckMiddleware implements NestMiddleware {
  private readonly logger = new Logger(OriginCheckMiddleware.name);
  private readonly allowedOrigins: string[];

  constructor(configService: ConfigService) {
    // Resolved once at construction: the allowlist comes from validated env and
    // cannot change while the process runs.
    this.allowedOrigins = resolveAllowedOrigins(configService);
  }

  /**
   * The API's own origin, derived from the request rather than configuration.
   *
   * This keeps the Swagger UI at `/api/docs` usable — it is served by this
   * server, so its "Try it out" requests carry the API's origin, which is not
   * in the frontend allowlist. Allowing it costs nothing: a request can only
   * carry this origin if it came from a page this server served, which is
   * precisely what an attacker cannot arrange.
   *
   * `req.protocol` respects `X-Forwarded-Proto` because `trust proxy` is set,
   * so this stays correct behind Render's TLS termination.
   */
  private isSameOrigin(req: Request, origin: string): boolean {
    const host = req.get('host');
    return Boolean(host) && origin === `${req.protocol}://${host}`;
  }

  use(req: Request, res: Response, next: NextFunction): void {
    if (!STATE_CHANGING_METHODS.has(req.method.toUpperCase())) return next();

    const origin = req.headers.origin;

    /*
     * A missing `Origin` is rejected, not waved through.
     *
     * Browsers always send it on a state-changing request — cross-origin fetch
     * and cross-site form POSTs alike — so its absence means the caller is not
     * a browser page. Every legitimate writer of this API is one: it is a
     * single SPA, and there is no server-to-server or webhook traffic. Allowing
     * the blank case would also reopen the gap for older clients that omit the
     * header on form navigations, which is the exact shape a CSRF attack takes.
     *
     * The literal string 'null' is the same story from the other direction: a
     * sandboxed iframe or a redirected cross-origin request serialises its
     * origin that way, and neither is something this API should act on. It
     * fails the allowlist check below on its own, since 'null' is never a
     * configured URL.
     *
     * The consequence to know about: `curl -X POST` without an `-H 'Origin:'`
     * now gets a 403. That is deliberate, and the warning below names the
     * method and path so a legitimate client tripping this is diagnosable
     * immediately rather than mysterious.
     */
    if (!origin) {
      this.logger.warn(
        `Chặn ${req.method} ${req.originalUrl}: thiếu header Origin.`,
      );
      throw new ForbiddenException({
        statusCode: 403,
        message: FORBIDDEN_MESSAGE,
      });
    }

    if (this.allowedOrigins.includes(origin) || this.isSameOrigin(req, origin)) {
      return next();
    }

    /*
     * Logged at `warn` rather than swallowed: a real CSRF attempt is the only
     * thing that produces this line in production, and it is the only trace of
     * it that will ever exist. A burst of these against `/api/auth/refresh` or
     * `/api/analysis/analyze` is worth someone looking at.
     */
    this.logger.warn(
      `Chặn ${req.method} ${req.originalUrl}: Origin '${origin}' không thuộc allowlist.`,
    );

    throw new ForbiddenException({
      statusCode: 403,
      message: FORBIDDEN_MESSAGE,
    });
  }
}
