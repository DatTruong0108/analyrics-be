/* System Package */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, RefreshToken, RevokeReason } from '@prisma/client';
import { Result, Ok, Err } from 'oxide.ts';

/* Application Package */
import { PrismaService } from 'src/prisma/prisma.service';
import {
  ClaimAndRotateParams,
  ClaimOutcome,
  IRefreshTokenRepository,
  IssueRefreshTokenParams,
} from './refresh-token.repository';

/**
 * Sentinel used to abort an interactive transaction.
 *
 * Prisma rolls a `$transaction` back only on a thrown exception — *returning*
 * an error value commits everything written so far. Since `Result` is the
 * house convention, an `Err` returned from inside the callback would look like
 * a handled failure while quietly leaving the parent token revoked and its
 * replacement missing: the user would be hard-logged-out by a "handled" error.
 *
 * So the callback throws this instead, and the repository boundary catches it
 * and maps it back to `Err`. Private on purpose — it must never escape.
 */
class TransactionAbort extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = 'TransactionAbort';
  }
}

@Injectable()
export class RefreshTokenRepositoryImpl implements IRefreshTokenRepository {
  private readonly SYSTEM_ERROR = 'Hệ thống bị lỗi, vui lòng thử lại sau.';
  private readonly logger = new Logger(RefreshTokenRepositoryImpl.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Flattens a caught value into something loggable, preferring the stack.
   *
   * Generic rather than `unknown` because `.claude/rules/api-style.md` forbids
   * `unknown`, and generic rather than a `string | Error` union because this
   * project leaves `useUnknownInCatchVariables` off — a caught value arrives as
   * `any`, and a union parameter makes every call site an unsafe-argument
   * warning. The `instanceof` guard is what actually makes this safe at
   * runtime, regardless of what the caller hands over.
   */
  private describe<T>(error: T): string {
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
  }

  async issue(
    params: IssueRefreshTokenParams,
  ): Promise<Result<RefreshToken, string>> {
    try {
      const row = await this.prisma.refreshToken.create({ data: params });
      return Ok(row);
    } catch (error) {
      this.logger.error(
        `Không thể phát hành refresh token cho user ${params.userId}`,
        this.describe(error),
      );
      return Err(this.SYSTEM_ERROR);
    }
  }

  /**
   * The mutex for the whole rotation scheme.
   *
   * A plain transaction is not enough here. At PostgreSQL's default READ
   * COMMITTED, "read the row, see revokedAt null, then write it" is not
   * atomic: two concurrent refreshes carrying the same cookie both read null,
   * both proceed, and the family ends up with two live children — which means
   * two divergent sessions from one stolen token, and reuse detection can
   * never fire for that family again. A transaction gives all-or-nothing per
   * branch, not mutual exclusion between branches.
   *
   * The conditional updateMany closes that. Postgres takes a row lock for the
   * first writer; the second blocks, and when it wakes it re-evaluates
   * `revokedAt: null` against the newly committed version, matches zero rows,
   * and reports count 0. Exactly one caller ever sees count 1. Claim first,
   * diagnose second — never the other way round.
   */
  async claimAndRotate(
    params: ClaimAndRotateParams,
  ): Promise<Result<ClaimOutcome, string>> {
    const { tokenHash, newTokenHash, newExpiresAt, now } = params;

    try {
      const outcome = await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient): Promise<ClaimOutcome> => {
          const claimed = await tx.refreshToken.updateMany({
            where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
            data: { revokedAt: now, revokedReason: RevokeReason.ROTATED },
          });

          // Lost the race, or the token was already revoked or expired. Nothing
          // was written, so committing an empty transaction is correct.
          if (claimed.count === 0) return { outcome: 'NOT_CLAIMED' };

          const parent = await tx.refreshToken.findUnique({
            where: { tokenHash },
          });

          /*
           * We just updated this row, so its absence means housekeeping deleted
           * it underneath us. Abort rather than continue: without the parent
           * there is no familyId to inherit, and inventing one would silently
           * fork the family into two independently-rotating chains that could
           * never be revoked together.
           */
          if (!parent) throw new TransactionAbort('claimed row disappeared');

          const child = await tx.refreshToken.create({
            data: {
              userId: parent.userId,
              tokenHash: newTokenHash,
              // Inherited, never regenerated — the family is what ties a chain
              // of rotations together for revocation and reuse detection.
              familyId: parent.familyId,
              expiresAt: newExpiresAt,
            },
          });

          return { outcome: 'CLAIMED', parent, child };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 2_000,
          timeout: 5_000,
        },
      );

      return Ok(outcome);
    } catch (error) {
      /*
       * A unique-constraint violation on tokenHash means the caller's 256-bit
       * random token collided — probability around 10^-58. Reported as a system
       * error and never retried: a real collision means the RNG is broken, and
       * a retry loop would hide exactly the failure worth knowing about.
       */
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.error(
          'Trùng tokenHash khi rotate refresh token — kiểm tra nguồn ngẫu nhiên.',
        );
        return Err(this.SYSTEM_ERROR);
      }

      const detail =
        error instanceof TransactionAbort ? error.detail : this.describe(error);
      this.logger.error(`Rotate refresh token thất bại: ${detail}`);
      return Err(this.SYSTEM_ERROR);
    }
  }

  async findByHash(
    tokenHash: string,
  ): Promise<Result<RefreshToken | null, string>> {
    try {
      // No revokedAt filter — see the interface doc. Revoked rows are the whole
      // point of this lookup.
      const row = await this.prisma.refreshToken.findUnique({
        where: { tokenHash },
      });
      return Ok(row);
    } catch (error) {
      this.logger.error('Không thể tra cứu refresh token', this.describe(error));
      return Err(this.SYSTEM_ERROR);
    }
  }

  async revokeFamily(
    familyId: string,
    reason: RevokeReason,
    now: Date,
  ): Promise<Result<number, string>> {
    try {
      /*
       * The `revokedAt: null` filter is load-bearing twice over. It keeps the
       * forensic record — when each rotation actually happened — instead of
       * flattening a whole family to one timestamp. And it stops an already
       * rotated row having its revokedAt pushed forward to now, which would
       * drag long-dead tokens back inside the grace window and hand a replay
       * the benign path instead of flagging it.
       */
      const { count } = await this.prisma.refreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: now, revokedReason: reason },
      });
      return Ok(count);
    } catch (error) {
      this.logger.error(
        `Không thể thu hồi family ${familyId}`,
        this.describe(error),
      );
      return Err(this.SYSTEM_ERROR);
    }
  }

  async markGraceUsed(id: string, now: Date): Promise<Result<boolean, string>> {
    try {
      // Conditional, so this is itself a mutex: two losers of the same race can
      // both decide "grace" from a stale read, but only one can stamp it.
      const { count } = await this.prisma.refreshToken.updateMany({
        where: { id, graceUsedAt: null },
        data: { graceUsedAt: now },
      });
      return Ok(count === 1);
    } catch (error) {
      this.logger.error(
        `Không thể ghi graceUsedAt cho token ${id}`,
        this.describe(error),
      );
      return Err(this.SYSTEM_ERROR);
    }
  }

  async deleteExpiredForUser(
    userId: string,
    now: Date,
  ): Promise<Result<number, string>> {
    try {
      // Expiry only — see the interface doc on why revoked rows must survive.
      const { count } = await this.prisma.refreshToken.deleteMany({
        where: { userId, expiresAt: { lte: now } },
      });
      return Ok(count);
    } catch (error) {
      this.logger.error(
        `Không thể dọn refresh token hết hạn của user ${userId}`,
        this.describe(error),
      );
      return Err(this.SYSTEM_ERROR);
    }
  }
}
