/* System Package */
import { RevokeReason } from '@prisma/client';

/**
 * Why a presented refresh token could not be exchanged, and what the caller is
 * therefore allowed to do about it.
 *
 * Deliberately a pure function with no Prisma client, no Logger and no
 * Response: this is the security-critical half of `/auth/refresh`, and keeping
 * it free of I/O is what makes every branch testable without a database. The
 * service's job is reduced to obeying the flags — which is the point, because
 * the flags are where the dangerous decision lives.
 *
 * Every outcome is an HTTP 401, so there is no status field to get wrong: what
 * differs between branches is only the side effects — cookies and family
 * revocation — plus whether the client should retry.
 */

/**
 * How long after a rotation a replay of the *old* token is still forgiven.
 *
 * Only has to span the multi-tab race: the frontend's single-flight already
 * collapses concurrent refreshes within one tab. Kept short because every
 * second of it is a second in which a genuinely stolen token goes unflagged.
 */
export const GRACE_WINDOW_MS = 5_000;

export type RefreshDecisionKind = 'reject' | 'grace' | 'reuse';

export type RefreshDecisionReason =
  /** No row for this hash — or no cookie was presented at all. */
  | 'NOT_FOUND'
  /** Never revoked, simply past `expiresAt`. */
  | 'EXPIRED'
  /** Lost a rotation race inside the grace window. The benign case. */
  | 'ROTATED_WITHIN_GRACE'
  /** A revoked token presented again. Treated as a stolen credential. */
  | 'REUSE_DETECTED'
  /** Live, unexpired, unrevoked — yet could not be claimed. Should not happen. */
  | 'UNCLAIMABLE_LIVE_ROW';

export interface RefreshDecision {
  kind: RefreshDecisionKind;
  reason: RefreshDecisionReason;
  /**
   * Whether to erase both auth cookies. **`false` on the grace path**, and that
   * is not an oversight: the grace response is by definition the *loser* of a
   * rotation race, so it lands after the winner has already set a fresh
   * `refresh_token`. Clearing here would delete the winner's brand-new cookie
   * and log out a user whose refresh had just succeeded.
   */
  clearCookies: boolean;
  /** Whether to revoke the whole token family. Only ever on reuse. */
  revokeFamily: boolean;
  /**
   * Surfaced to the client so it can distinguish "retry, you lost a race" from
   * "you are signed out". Without it the frontend routes a benign race straight
   * to the sign-in screen.
   */
  retryable: boolean;
}

/** The fields of a `RefreshToken` row this decision reads, and nothing else. */
export interface RefreshTokenState {
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: RevokeReason | null;
  graceUsedAt: Date | null;
}

const reject = (reason: RefreshDecisionReason): RefreshDecision => ({
  kind: 'reject',
  reason,
  clearCookies: true,
  revokeFamily: false,
  retryable: false,
});

/**
 * Diagnoses a refresh that could not be claimed.
 *
 * Pass `null` both when the hash matched no row and when no cookie was
 * presented at all: the outcomes are identical, because an unknown hash
 * identifies no family and so there is nothing to revoke.
 *
 * @param row   the matching row, or `null`
 * @param now   evaluation time, injected so the grace window is testable
 * @param graceMs width of the grace window; defaults to {@link GRACE_WINDOW_MS}
 */
export function decideRefresh(
  row: RefreshTokenState | null,
  now: Date,
  graceMs: number = GRACE_WINDOW_MS,
): RefreshDecision {
  if (!row) return reject('NOT_FOUND');

  /*
   * Revocation is checked before expiry, and the order is load-bearing. A
   * stolen token replayed after its own `expiresAt` is still a replay; if
   * expiry won, that row would take the harmless `reject` path and the family
   * would never be revoked — reuse detection would silently stop covering old
   * tokens, which are exactly the ones an attacker sits on.
   */
  if (row.revokedAt) {
    const elapsedMs = now.getTime() - row.revokedAt.getTime();

    /*
     * Grace needs all three conditions, and each one closes a specific hole:
     *
     * - `ROTATED` only. A family mass-revoked for REUSE has every row at
     *   `revokedAt ≈ now`, so a time-only check would route every replay in
     *   that dead family through grace for the next 5 seconds — silencing
     *   reuse detection at the exact moment it had just fired.
     *
     * - `graceUsedAt` still null. A row is forgiven at most once. This is what
     *   defeats the stolen-token race: an attacker who refreshes first wins,
     *   but the victim's *second* replay falls through to reuse and revokes the
     *   family out from under the attacker.
     *
     * A negative `elapsedMs` (revocation timestamped in the future) is clock
     * skew between the database and this process, not an attack — an attacker
     * cannot write `revokedAt`. Treated as inside the window.
     */
    const isWithinGrace =
      row.revokedReason === RevokeReason.ROTATED &&
      row.graceUsedAt === null &&
      elapsedMs <= graceMs;

    if (isWithinGrace) {
      return {
        kind: 'grace',
        reason: 'ROTATED_WITHIN_GRACE',
        clearCookies: false,
        revokeFamily: false,
        retryable: true,
      };
    }

    return {
      kind: 'reuse',
      reason: 'REUSE_DETECTED',
      clearCookies: true,
      revokeFamily: true,
      retryable: false,
    };
  }

  if (row.expiresAt.getTime() <= now.getTime()) return reject('EXPIRED');

  /*
   * Unreachable in principle: the caller only diagnoses after a failed claim,
   * and a live unexpired row is claimable. Returned rather than thrown so that
   * an invariant violation degrades to a re-login instead of a 500 — but the
   * distinct reason exists so the service can log it loudly, because reaching
   * here means the claim mutex is not doing its job.
   */
  return reject('UNCLAIMABLE_LIVE_ROW');
}
