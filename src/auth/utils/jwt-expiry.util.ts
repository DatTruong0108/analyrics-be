/* System Package */
import { JwtSignOptions } from '@nestjs/jwt';

/**
 * Whatever @nestjs/jwt currently accepts for `signOptions.expiresIn`:
 * a number of seconds, or an `ms`-parsable duration string such as '7d'.
 */
export type JwtExpiresIn = NonNullable<JwtSignOptions['expiresIn']>;

/** Fallback lifetime for signed access tokens. */
export const DEFAULT_JWT_EXPIRES_IN = '7d';

/**
 * Mirrors the grammar `ms` actually accepts.
 *
 * The separator is a literal space, not `\s`: `ms` rejects a tab or a
 * non-breaking space, so accepting those here would let a copy-pasted value
 * boot cleanly and then throw on every single login instead of at startup.
 *
 * Capture 1 is the amount, capture 2 the unit (absent for bare seconds).
 */
export const JWT_EXPIRES_IN_PATTERN =
  /^(\d+(?:\.\d+)?)[ ]*(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i;

const BARE_SECONDS_PATTERN = /^\d+$/;

/**
 * Whether a configured lifetime will actually yield a usable, positive token
 * lifetime. Used as the boot-time validator so a bad value stops startup.
 */
export function isUsableJwtExpiresIn(raw: string | undefined): boolean {
  const value = raw?.trim();
  if (!value) return false;

  const match = JWT_EXPIRES_IN_PATTERN.exec(value);
  if (!match) return false;

  const amount = Number.parseFloat(match[1]);
  if (!(amount > 0)) return false;

  // A bare number means seconds, so it must be a whole, representable count.
  // Fractions need an explicit unit ('1.5h'), which keeps `exp` an integer.
  const hasUnit = Boolean(match[2]);
  if (!hasUnit && !Number.isSafeInteger(amount)) return false;

  return true;
}

/**
 * Normalises a configured lifetime for `jsonwebtoken`.
 *
 * A duration string is handed over verbatim — parsing '7d' as a number would
 * truncate it to 7. A bare number, however, must be passed as a *number*:
 * `jsonwebtoken` reads numbers as seconds but delegates strings to `ms`,
 * which reads a unit-less string as milliseconds. So '3600' as a string would
 * mean 3.6 seconds, while 3600 as a number means one hour.
 */
export function resolveJwtExpiresIn(raw: string | undefined): JwtExpiresIn {
  const value = raw?.trim();
  if (!value) return DEFAULT_JWT_EXPIRES_IN;

  if (BARE_SECONDS_PATTERN.test(value)) return Number(value);

  return value as JwtExpiresIn;
}
