/* System Package */
import { minutes } from '@nestjs/throttler';

/**
 * Rate-limit settings. `ttl` values are in milliseconds — the `minutes()`
 * helper from @nestjs/throttler does that conversion.
 *
 * The guard's default key is a hash of controller + handler + tracker, so
 * these budgets are already per-route and per-client, not shared app-wide.
 */

/** Baseline for every route: generous, aimed only at runaway clients. */
export const DEFAULT_THROTTLE_LIMIT = 60;
export const DEFAULT_THROTTLE_TTL = minutes(1);

/**
 * POST /analysis/analyze fans out to Gemini plus LrcLib/Deezer whenever the
 * cache misses, so each call spends real money and third-party quota. It gets
 * a much tighter budget than the read-only routes around it.
 */
export const ANALYZE_THROTTLE_LIMIT = 5;
export const ANALYZE_THROTTLE_TTL = minutes(1);

/**
 * Credential endpoints: login and register.
 *
 * The 60/min default is far too loose for anything that checks a password —
 * that is 86,400 guesses a day from one address. Ten still absorbs ordinary
 * typos and a fat-fingered password manager without being useful for guessing.
 *
 * Note this is keyed per client IP (via `trust proxy`), not per email, so a
 * distributed attempt against one account is not covered. B4's suggestion to
 * key on `dto.email` by overriding `getTracker` would close that and is worth
 * doing, but it is not implemented here.
 */
export const LOGIN_THROTTLE_LIMIT = 10;
export const LOGIN_THROTTLE_TTL = minutes(1);

/**
 * Token rotation. Legitimately more frequent than login — several tabs can each
 * refresh, and the grace path deliberately tells losers to retry — so this sits
 * above the credential budget while staying well under the 60/min default a
 * cookie-driven endpoint should not have.
 */
export const REFRESH_THROTTLE_LIMIT = 30;
export const REFRESH_THROTTLE_TTL = minutes(1);

/** Matches the Vietnamese user-facing messages the rest of the API returns. */
export const THROTTLE_ERROR_MESSAGE =
  'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.';
