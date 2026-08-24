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

/** Matches the Vietnamese user-facing messages the rest of the API returns. */
export const THROTTLE_ERROR_MESSAGE =
  'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.';
