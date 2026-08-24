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

/**
 * Multipliers for every unit `JWT_EXPIRES_IN_PATTERN` accepts, keyed by the
 * lower-cased unit as written. A year is 365.25 days, matching `ms`, so a
 * value spelled '1y' means the same number of milliseconds here as it does
 * inside the token it was used to sign.
 */
const UNIT_TO_MS: Record<string, number> = {
  ms: 1,
  msec: 1,
  msecs: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1_000,
  sec: 1_000,
  secs: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
  y: 31_557_600_000,
  yr: 31_557_600_000,
  yrs: 31_557_600_000,
  year: 31_557_600_000,
  years: 31_557_600_000,
};

/**
 * Milliseconds a configured lifetime is worth — for cookie `maxAge` and for
 * comparing two configured lifetimes against each other.
 *
 * Deliberately built on `JWT_EXPIRES_IN_PATTERN` rather than on `ms` directly,
 * for two reasons. It cannot drift from `resolveJwtExpiresIn`: any value the
 * boot-time validator lets through is a value this function can convert, so a
 * cookie lifetime can never disagree with the token lifetime it accompanies.
 * And it fixes `ms`'s inversion for unit-less input — `ms('3600')` is 3.6
 * seconds, whereas `jsonwebtoken` reads a unit-less `3600` as an hour. Seconds
 * is the reading that matches the token, so seconds is what this returns.
 *
 * @throws RangeError if `raw` is not a usable lifetime. Callers reading
 * untrusted configuration should gate on `isUsableJwtExpiresIn` first; a
 * fallback return value would surface as `maxAge: 0`, a cookie the browser
 * discards the instant it arrives.
 */
export function parseDurationToMs(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value || !isUsableJwtExpiresIn(value)) {
    throw new RangeError(`Không thể đọc thời hạn: '${raw ?? ''}'`);
  }

  // Safe to assert: `isUsableJwtExpiresIn` ran the same pattern above.
  const match = JWT_EXPIRES_IN_PATTERN.exec(value)!;
  const amount = Number.parseFloat(match[1]);
  const unit = match[2]?.toLowerCase();

  // No unit means seconds, per `jsonwebtoken`'s reading of a bare number.
  if (!unit) return amount * 1_000;

  return amount * UNIT_TO_MS[unit];
}
