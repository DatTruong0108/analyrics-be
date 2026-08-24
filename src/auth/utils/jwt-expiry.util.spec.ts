/* Application Package */
import { parseDurationToMs } from './jwt-expiry.util';

describe('parseDurationToMs', () => {
  /*
   * The whole reason this function exists rather than a `ms(raw)` call.
   *
   * `ms` reads a unit-less *string* as milliseconds, but every other consumer
   * of these env values (jsonwebtoken, and therefore `resolveJwtExpiresIn`)
   * reads a unit-less value as *seconds*. Handing '3600' straight to `ms`
   * yields 3.6 seconds, so a cookie `maxAge` built that way would expire the
   * session a thousand times too early — and only for deployments that
   * configured a bare number, which is exactly the case nobody tests.
   */
  it('reads a bare number as seconds, not milliseconds', () => {
    expect(parseDurationToMs('3600')).toBe(3_600_000);
  });

  // The two reference values from the plan: they are the access- and
  // refresh-token lifetimes, and both end up as literal cookie `maxAge`s.
  it('converts the configured access-token lifetime', () => {
    expect(parseDurationToMs('7d')).toBe(604_800_000);
  });

  it('converts the configured refresh-token lifetime', () => {
    expect(parseDurationToMs('30d')).toBe(2_592_000_000);
  });

  /*
   * Guards the cross-check in `envValidationSchema`: it compares refresh TTL
   * against access TTL, which is only meaningful if differently-spelled units
   * land on the same scale.
   */
  it('normalises mixed units onto one scale', () => {
    expect(parseDurationToMs('1h')).toBe(3_600_000);
    expect(parseDurationToMs('60 minutes')).toBe(3_600_000);
    expect(parseDurationToMs('1.5h')).toBe(5_400_000);
  });

  /*
   * `JWT_EXPIRES_IN_PATTERN` permits a fractional amount ('1.5h'), and the
   * result lands in a cookie's `maxAge` — which serialises to `Max-Age`, an
   * integer per RFC 6265. A fractional millisecond would emit `Max-Age=1.5`
   * and be discarded by the browser as malformed.
   */
  it('always returns a whole number of milliseconds', () => {
    expect(parseDurationToMs('1.5ms')).toBe(2);
    expect(Number.isInteger(parseDurationToMs('1.5h'))).toBe(true);
  });

  // Callers are expected to have run `isUsableJwtExpiresIn` first, so an
  // unparsable value is a programming error, not a value to paper over with a
  // silent 0 — a 0 would become `maxAge: 0`, i.e. a cookie deleted on arrival.
  it('throws rather than returning a silent zero for junk input', () => {
    expect(() => parseDurationToMs('soon')).toThrow(RangeError);
    expect(() => parseDurationToMs('')).toThrow(RangeError);
  });
});
