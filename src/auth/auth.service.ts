/* System Package */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RevokeReason } from '@prisma/client';
import { Result, Ok, Err } from 'oxide.ts';
import { hash, compare } from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'crypto';

/* Application Package */
import { IAuthRepository } from './repositories/auth.repository';
import { IRefreshTokenRepository } from './repositories/refresh-token.repository';
import {
  IAuthSession,
  IRefreshFailure,
  IUser,
} from './interfaces/auth.interface';
import { IJwtPayload } from './interfaces/jwt.interface';
import { LoginDto, RegisterDto } from './auth.dto';
import { parseDurationToMs } from './utils/jwt-expiry.util';
import { decideRefresh } from './utils/refresh-decision.util';

@Injectable()
export class AuthService {
  private readonly SYSTEM_ERROR = 'Hệ thống bị lỗi, vui lòng thử lại sau.';
  private readonly INVALID_SESSION = 'Phiên đăng nhập không hợp lệ.';

  /**
   * The only logger in `src/auth/`. Reuse detection that is not logged is
   * detection that does not exist — and with 7-day access tokens, the warning
   * emitted on the reuse branch may be the only signal that a token was ever
   * stolen.
   */
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly authRepository: IAuthRepository,
    private readonly refreshTokenRepository: IRefreshTokenRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Mints an opaque refresh token and the hash that will be stored for it.
   *
   * 256 bits of CSPRNG output, so it is not guessable and does not need a slow
   * hash; sha256 keeps the column indexable for the equality lookup every
   * refresh performs. The plaintext is returned to the caller and immediately
   * forgotten — only `tokenHash` is ever written down.
   */
  private mintRefreshToken(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: this.hashToken(token) };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshTtlMs(): number {
    // Joi validates this at boot (and asserts it exceeds JWT_EXPIRES_IN), so
    // parsing cannot fail here.
    return parseDurationToMs(
      this.configService.get<string>('REFRESH_TOKEN_EXPIRES_IN'),
    );
  }

  /**
   * Signs an access token from the *current* user row and reports when it
   * expires, taking `exp` back off the signed token rather than recomputing it
   * so the two can never disagree.
   */
  private signAccessToken(user: IUser): {
    accessToken: string;
    accessTokenExpiresAt: number;
  } {
    const payload: IJwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const accessToken = this.jwtService.sign(payload);
    const decoded = this.jwtService.decode<IJwtPayload | null>(accessToken);

    const accessTokenExpiresAt = decoded?.exp
      ? decoded.exp * 1_000
      : Date.now() +
        parseDurationToMs(this.configService.get<string>('JWT_EXPIRES_IN'));

    return { accessToken, accessTokenExpiresAt };
  }

  /**
   * Starts a brand-new token family for a user who has just proved who they
   * are. Used by login and register — never by refresh, which must inherit the
   * existing family so revocation stays able to kill the whole chain.
   */
  private async startSession(user: IUser): Promise<Result<IAuthSession, string>> {
    const { token, tokenHash } = this.mintRefreshToken();
    const now = new Date();

    const issued = await this.refreshTokenRepository.issue({
      userId: user.id,
      tokenHash,
      familyId: randomUUID(),
      expiresAt: new Date(now.getTime() + this.refreshTtlMs()),
    });
    if (issued.isErr()) return Err(issued.unwrapErr());

    const { accessToken, accessTokenExpiresAt } = this.signAccessToken(user);
    return Ok({ user, accessToken, refreshToken: token, accessTokenExpiresAt });
  }

  /**
   * Drops the user's expired rows without letting that failure reach them.
   *
   * Deliberately not awaited: housekeeping is not part of signing in, and a
   * dead cleanup query must never turn a valid login into an error.
   */
  private pruneExpiredInBackground(userId: string): void {
    void this.refreshTokenRepository
      .deleteExpiredForUser(userId, new Date())
      .catch(() => {
        this.logger.warn(`Không thể dọn refresh token cũ của user ${userId}`);
      });
  }

  /**
   * Registers and signs the user in.
   *
   * Returns a full session rather than just the user: having the frontend chain
   * register then login would double the failure surface for no gain. The
   * response *body* contract is unchanged — only `Set-Cookie` is added.
   */
  async register(dto: RegisterDto): Promise<Result<IAuthSession, string>> {
    const existingRes = await this.authRepository.findByEmail(dto.email);
    if (existingRes.isErr()) return Err(existingRes.unwrapErr());

    if (existingRes.unwrap()) return Err('Email đã tồn tại trong hệ thống.');

    const hashedPass = await hash(dto.password, 10);
    const createdRes = await this.authRepository.createUser(dto, hashedPass);
    if (createdRes.isErr()) return Err(createdRes.unwrapErr());

    return this.startSession(createdRes.unwrap());
  }

  async login(dto: LoginDto): Promise<Result<IAuthSession, string>> {
    try {
      const userResponse = await this.authRepository.findByEmail(dto.email);
      if (userResponse.isErr()) return Err(userResponse.unwrapErr());

      const user = userResponse.unwrap();
      if (!user || !user.password) {
        return Err('Tài khoản hoặc mật khẩu không chính xác.');
      }

      const isMatch = await compare(dto.password, user.password);
      if (!isMatch) {
        return Err('Tài khoản hoặc mật khẩu không chính xác.');
      }

      const session = await this.startSession(user);
      if (session.isOk()) this.pruneExpiredInBackground(user.id);

      return session;
    } catch (error) {
      this.logger.error(
        `Đăng nhập thất bại cho ${dto.email}`,
        error instanceof Error ? error.stack : String(error),
      );
      return Err('Đăng nhập thất bại. ' + this.SYSTEM_ERROR);
    }
  }

  /**
   * Exchanges a refresh token for a new pair, rotating the old one.
   *
   * Claim first, diagnose second. The claim is the mutex (see
   * `claimAndRotate`); only when it *loses* is the reject/grace/reuse decision
   * of `decideRefresh` consulted, because only the losing path needs to know
   * whether this was a benign race or a stolen token.
   */
  async refresh(
    presentedToken: string | undefined,
  ): Promise<Result<IAuthSession, IRefreshFailure>> {
    const reject = (message: string): IRefreshFailure => ({
      kind: 'INVALID',
      message,
      clearCookies: true,
      retryable: false,
    });

    /*
     * Infrastructure trouble, not a verdict on the token. Cookies stay put: a
     * failed query is no evidence the session is bad, and destroying it would
     * turn a transient blip into a mass logout.
     */
    const systemFailure = (message: string): IRefreshFailure => ({
      kind: 'SYSTEM',
      message,
      clearCookies: false,
      retryable: true,
    });

    if (!presentedToken) {
      return Err(reject(this.INVALID_SESSION));
    }

    const tokenHash = this.hashToken(presentedToken);
    const now = new Date();
    const { token: newToken, tokenHash: newTokenHash } =
      this.mintRefreshToken();

    const claim = await this.refreshTokenRepository.claimAndRotate({
      tokenHash,
      newTokenHash,
      newExpiresAt: new Date(now.getTime() + this.refreshTtlMs()),
      now,
    });
    if (claim.isErr()) return Err(systemFailure(claim.unwrapErr()));

    const outcome = claim.unwrap();

    if (outcome.outcome === 'CLAIMED') {
      /*
       * Re-read the user and sign from current database state. Copying `role`
       * out of the token being replaced would make a demotion permanent for as
       * long as the family keeps rotating, instead of expiring with the access
       * token that carried it.
       */
      const userRes = await this.authRepository.findById(outcome.parent.userId);
      if (userRes.isErr()) return Err(systemFailure(userRes.unwrapErr()));

      const user = userRes.unwrap();
      if (!user) {
        // Fail closed: the row is gone, so there is no current state to sign
        // from and nothing legitimate this token could still be for.
        this.logger.error(
          `Refresh thành công nhưng user ${outcome.parent.userId} không còn tồn tại`,
        );
        return Err(reject(this.INVALID_SESSION));
      }

      const { accessToken, accessTokenExpiresAt } = this.signAccessToken(user);
      return Ok({
        user,
        accessToken,
        refreshToken: newToken,
        accessTokenExpiresAt,
      });
    }

    // The claim lost. Work out why, and only now decide about cookies.
    const rowRes = await this.refreshTokenRepository.findByHash(tokenHash);
    if (rowRes.isErr()) return Err(systemFailure(rowRes.unwrapErr()));

    const row = rowRes.unwrap();
    const decision = decideRefresh(row, now);

    if (decision.kind === 'grace' && row) {
      /*
       * Someone else rotated this token moments ago, so this request is the
       * loser of a multi-tab race rather than an attack. `clearCookies` stays
       * false: the winner has already set a fresh refresh_token, and this
       * response lands after it — clearing here would delete the winner's new
       * cookie and log out a user whose refresh had just succeeded.
       */
      const marked = await this.refreshTokenRepository.markGraceUsed(
        row.id,
        now,
      );

      /*
       * `false` means a concurrent loser stamped the row first. Still treated
       * as grace: that can only happen when several tabs race the *same*
       * rotation, which is the benign case this window exists for. The attack
       * shape B5 describes is sequential — a later replay finds `graceUsedAt`
       * already set and falls through to reuse below.
       */
      if (marked.isErr()) {
        this.logger.warn(
          `Không ghi được graceUsedAt cho token ${row.id}, vẫn cho phép thử lại`,
        );
      }

      this.logger.debug(
        `Refresh thua cuộc đua trong cửa sổ grace, family ${row.familyId}`,
      );

      return Err({
        kind: 'RACE',
        message: 'Phiên đang được làm mới, vui lòng thử lại.',
        clearCookies: false,
        retryable: true,
      });
    }

    if (decision.kind === 'reuse' && row) {
      this.logger.warn(
        `Phát hiện tái sử dụng refresh token: family ${row.familyId}, ` +
          `user ${row.userId}, đã thu hồi lúc ${row.revokedAt?.toISOString() ?? 'n/a'}. ` +
          'Thu hồi toàn bộ family.',
      );

      const revoked = await this.refreshTokenRepository.revokeFamily(
        row.familyId,
        RevokeReason.REUSE,
        now,
      );
      if (revoked.isErr()) {
        this.logger.error(
          `Không thu hồi được family ${row.familyId} sau khi phát hiện tái sử dụng`,
        );
      }
    }

    return Err({
      kind: 'INVALID',
      message: this.INVALID_SESSION,
      clearCookies: decision.clearCookies,
      retryable: decision.retryable,
    });
  }

  /**
   * Signs this device out by revoking the presented token's family.
   *
   * **Outstanding access tokens are not revoked and stay valid for up to their
   * full 7-day lifetime.** Logout ends the ability to *refresh*, not the
   * ability to use an access token already issued. Anything that needs
   * immediate hard revocation needs a token blocklist, which this does not
   * implement — do not read this method as a full sign-out.
   *
   * Idempotent by design: a missing, unknown or already-revoked token still
   * returns `Ok`, so a corrupted session is always escapable rather than
   * trapping the user on a 500.
   */
  /**
   * Reads a user by id for `/auth/me`.
   *
   * The access token carries only `sub`, `email`, `role` and `exp`; `name` and
   * `createdAt` are not in it, so the profile payload has to come from the row
   * rather than from claims. That also means /auth/me reflects a rename or a
   * role change immediately instead of at the next rotation.
   */
  async getProfile(userId: string): Promise<Result<IUser | null, string>> {
    return this.authRepository.findById(userId);
  }

  async logout(presentedToken: string | undefined): Promise<Result<boolean, string>> {
    try {
      if (!presentedToken) return Ok(true);

      /*
       * Looked up *without* a `revokedAt: null` filter. A user logging out
       * moments after a rotation presents a token that is already revoked but
       * still perfectly identifying, and its `familyId` is the only way to know
       * what to revoke. The family is always taken from this row, never from
       * anything the request supplied — otherwise a caller could name someone
       * else's family and sign them out.
       */
      const rowRes = await this.refreshTokenRepository.findByHash(
        this.hashToken(presentedToken),
      );
      if (rowRes.isErr()) return Err(rowRes.unwrapErr());

      const row = rowRes.unwrap();
      if (!row) return Ok(true);

      const revoked = await this.refreshTokenRepository.revokeFamily(
        row.familyId,
        RevokeReason.LOGOUT,
        new Date(),
      );
      if (revoked.isErr()) return Err(revoked.unwrapErr());

      this.logger.log(
        `Đăng xuất: đã thu hồi ${revoked.unwrap()} token của family ${row.familyId}`,
      );
      return Ok(true);
    } catch (error) {
      this.logger.error(
        'Đăng xuất thất bại',
        error instanceof Error ? error.stack : String(error),
      );
      return Err(this.SYSTEM_ERROR);
    }
  }
}
