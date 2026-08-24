/* System Package */
import { RevokeReason } from '@prisma/client';

/* Application Package */
import {
  GRACE_WINDOW_MS,
  RefreshTokenState,
  decideRefresh,
} from './refresh-decision.util';

const NOW = new Date('2026-08-24T12:00:00.000Z');

/** `now` minus a number of seconds, for building revocation timestamps. */
const secondsAgo = (s: number): Date => new Date(NOW.getTime() - s * 1_000);

/** A live, unexpired, never-revoked row. Each case spoils exactly one field. */
const liveRow = (over: Partial<RefreshTokenState> = {}): RefreshTokenState => ({
  expiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1_000),
  revokedAt: null,
  revokedReason: null,
  graceUsedAt: null,
  ...over,
});

describe('decideRefresh', () => {
  it('uses a 5-second grace window', () => {
    // The frontend single-flight already covers the same-tab race; this only
    // has to span multi-tab, so it stays deliberately short.
    expect(GRACE_WINDOW_MS).toBe(5_000);
  });

  describe('the grace branch — the point of this module', () => {
    /*
     * Two tabs present the same refresh token. The winner rotates it and gets a
     * fresh cookie; the loser arrives second and finds the row already revoked
     * ROTATED. The loser MUST NOT clear cookies: its response lands after the
     * winner's, so clearing would delete the freshly issued refresh_token and
     * log out a user who had just successfully refreshed.
     *
     * This is the single easiest bug in the whole feature to introduce, because
     * the obvious implementation is "any 401 from /auth/refresh clears cookies".
     */
    it('forgives a rotation lost by seconds without clearing cookies', () => {
      const decision = decideRefresh(
        liveRow({ revokedAt: secondsAgo(3), revokedReason: RevokeReason.ROTATED }),
        NOW,
      );

      expect(decision.kind).toBe('grace');
      expect(decision.clearCookies).toBe(false);
      expect(decision.revokeFamily).toBe(false);
      // The loser needs a distinguishable signal so the frontend retries
      // instead of routing the user to sign-in.
      expect(decision.retryable).toBe(true);
    });

    it('treats the window bound as inclusive, and anything past it as reuse', () => {
      const at = (ms: number) =>
        decideRefresh(
          liveRow({
            revokedAt: new Date(NOW.getTime() - ms),
            revokedReason: RevokeReason.ROTATED,
          }),
          NOW,
        ).kind;

      expect(at(GRACE_WINDOW_MS - 1)).toBe('grace');
      expect(at(GRACE_WINDOW_MS)).toBe('grace');
      expect(at(GRACE_WINDOW_MS + 1)).toBe('reuse');
    });
  });

  describe('reuse detection', () => {
    /*
     * Long past any plausible race, so a replay here is a stolen token being
     * presented after the legitimate holder already rotated it.
     */
    it('flags a replay well outside the window', () => {
      const decision = decideRefresh(
        liveRow({ revokedAt: secondsAgo(30), revokedReason: RevokeReason.ROTATED }),
        NOW,
      );

      expect(decision.kind).toBe('reuse');
      expect(decision.clearCookies).toBe(true);
      expect(decision.revokeFamily).toBe(true);
      expect(decision.retryable).toBe(false);
    });

    /*
     * Why grace is gated on `revokedReason` and not on the timestamp alone:
     * a family mass-revoked for REUSE has every row sitting at
     * `revokedAt ≈ now`, so a time-only check would hand the grace path to
     * every replay in that dead family for the next 5 seconds — silencing
     * reuse detection precisely when it has just fired.
     */
    it('never graces a family already killed for reuse', () => {
      const decision = decideRefresh(
        liveRow({ revokedAt: secondsAgo(3), revokedReason: RevokeReason.REUSE }),
        NOW,
      );

      expect(decision.kind).toBe('reuse');
      expect(decision.clearCookies).toBe(true);
      expect(decision.revokeFamily).toBe(true);
    });

    /*
     * Why grace is gated on `graceUsedAt`: forgiving at most once is what
     * closes the stolen-token scenario. An attacker who wins the race keeps the
     * family only until the victim's *second* replay, which trips this branch
     * and revokes the family out from under them.
     */
    it('forgives a given row at most once', () => {
      const decision = decideRefresh(
        liveRow({
          revokedAt: secondsAgo(3),
          revokedReason: RevokeReason.ROTATED,
          graceUsedAt: secondsAgo(2),
        }),
        NOW,
      );

      expect(decision.kind).toBe('reuse');
      expect(decision.clearCookies).toBe(true);
      expect(decision.revokeFamily).toBe(true);
    });

    it('does not grace a token revoked by an explicit logout', () => {
      const decision = decideRefresh(
        liveRow({ revokedAt: secondsAgo(3), revokedReason: RevokeReason.LOGOUT }),
        NOW,
      );

      expect(decision.kind).toBe('reuse');
      expect(decision.revokeFamily).toBe(true);
    });
  });

  describe('plain rejection', () => {
    /*
     * Also the "no cookie presented" row of the table: there is nothing to hash,
     * so the service passes null and gets the same decision. Nothing to revoke
     * either — an unknown hash identifies no family.
     */
    it('rejects an unknown hash without revoking anything', () => {
      const decision = decideRefresh(null, NOW);

      expect(decision.kind).toBe('reject');
      expect(decision.clearCookies).toBe(true);
      expect(decision.revokeFamily).toBe(false);
      expect(decision.retryable).toBe(false);
    });

    it('rejects an expired but never-revoked token', () => {
      const decision = decideRefresh(
        liveRow({ expiresAt: secondsAgo(1) }),
        NOW,
      );

      expect(decision.kind).toBe('reject');
      expect(decision.clearCookies).toBe(true);
      expect(decision.revokeFamily).toBe(false);
    });
  });

  /*
   * Ordering matters for security, not just tidiness. A stolen token replayed
   * after its own expiry is still a replay: if the expiry check ran first, this
   * row would take the harmless `reject` path and the family would never be
   * revoked, so reuse detection would quietly stop working for old tokens.
   */
  it('checks revocation before expiry, so a stale replay still revokes', () => {
    const decision = decideRefresh(
      liveRow({
        expiresAt: secondsAgo(60),
        revokedAt: secondsAgo(30),
        revokedReason: RevokeReason.ROTATED,
      }),
      NOW,
    );

    expect(decision.kind).toBe('reuse');
    expect(decision.revokeFamily).toBe(true);
  });
});
