/* System Package */
import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  HttpStatus,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Result, match } from 'oxide.ts';

/* Application Package */
import { AuthService } from './auth.service';
import {
  AuthSessionData,
  AuthSessionResponse,
  LoginDto,
  LogoutResponse,
  MeResponse,
  RefreshFailureResponse,
  RegisterDto,
  UserData,
} from './auth.dto';
import {
  IAuthSession,
  IRefreshFailure,
  IUser,
} from './interfaces/auth.interface';
import { IAuthUser } from './interfaces/jwt.interface';
import { AtGuard } from './guards/at.guard';
import { NoStoreInterceptor } from './interceptors/no-store.interceptor';
import { GetCurrentUser } from 'src/shared/decorators/getCurrentUser.decorator';
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  setAuthCookies,
} from './utils/auth-cookies.util';
import {
  LOGIN_THROTTLE_LIMIT,
  LOGIN_THROTTLE_TTL,
  REFRESH_THROTTLE_LIMIT,
  REFRESH_THROTTLE_TTL,
  THROTTLE_ERROR_MESSAGE,
} from 'src/shared/constants/throttle';

/** Narrows the `any`-typed bag cookie-parser attaches to the request. */
interface RequestWithCookies extends Request {
  cookies: Record<string, string | undefined>;
}

@Controller('/auth')
@ApiTags('Auth')
// Every auth response carries identity, and login/refresh arrive with
// Set-Cookie — none of it may be cached by a proxy or the browser.
@UseInterceptors(NoStoreInterceptor)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) { }

  private mapToUserData(user: IUser): UserData {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      created_at: user.createdAt,
    };
  }

  private get isProd(): boolean {
    return this.configService.get<string>('NODE_ENV') === 'production';
  }

  private toSessionData(session: IAuthSession): AuthSessionData {
    return {
      user: this.mapToUserData(session.user),
      accessTokenExpiresAt: session.accessTokenExpiresAt,
    };
  }

  /** Shared failure mapping for the credential routes. */
  private sendError(res: Response, err: string): void {
    const isSystem = err.includes('Hệ thống');
    const status = isSystem
      ? HttpStatus.INTERNAL_SERVER_ERROR
      : HttpStatus.BAD_REQUEST;

    res.status(status).json({ statusCode: status, message: err });
  }

  @Throttle({
    default: { limit: LOGIN_THROTTLE_LIMIT, ttl: LOGIN_THROTTLE_TTL },
  })
  @Post('login')
  @ApiOperation({
    summary: 'Đăng nhập',
    description:
      'Xác thực người dùng, đặt access_token và refresh_token dưới dạng cookie HttpOnly.',
  })
  @ApiOkResponse({ description: 'Đăng nhập thành công', type: AuthSessionResponse })
  @ApiBadRequestResponse({ description: 'Sai tài khoản hoặc mật khẩu' })
  @ApiTooManyRequestsResponse({ description: THROTTLE_ERROR_MESSAGE })
  async login(
    @Body() dto: LoginDto,
    @Res() res: Response,
  ): Promise<void> {
    const result: Result<IAuthSession, string> = await this.authService.login(dto);

    return match(result, {
      Ok: (session: IAuthSession) => {
        // Both cookies, one source of truth for their attributes — refresh is
        // scoped to /api/auth, access is site-wide.
        setAuthCookies(res, session, this.isProd);

        const response: AuthSessionResponse = {
          statusCode: HttpStatus.OK,
          message: 'Đăng nhập thành công',
          data: this.toSessionData(session),
        };

        res.status(HttpStatus.OK).json(response);
      },

      Err: (err: string) => this.sendError(res, err),
    });
  }

  @Throttle({
    default: { limit: LOGIN_THROTTLE_LIMIT, ttl: LOGIN_THROTTLE_TTL },
  })
  @Post('register')
  @ApiOperation({
    summary: 'Đăng ký tài khoản',
    description:
      'Tạo tài khoản và đăng nhập luôn — trả về cookie giống hệt /auth/login, ' +
      'nên client không cần gọi login sau khi đăng ký.',
  })
  @ApiCreatedResponse({
    description: 'Đăng ký và đăng nhập thành công',
    type: AuthSessionResponse,
  })
  @ApiBadRequestResponse({ description: 'Email đã tồn tại hoặc dữ liệu không hợp lệ' })
  @ApiTooManyRequestsResponse({ description: THROTTLE_ERROR_MESSAGE })
  async register(
    @Body() dto: RegisterDto,
    @Res() res: Response,
  ): Promise<void> {
    const result: Result<IAuthSession, string> = await this.authService.register(dto);

    return match(result, {
      Ok: (session: IAuthSession) => {
        setAuthCookies(res, session, this.isProd);

        const response: AuthSessionResponse = {
          statusCode: HttpStatus.CREATED,
          message: 'Đăng ký tài khoản thành công',
          data: this.toSessionData(session),
        };

        res.status(HttpStatus.CREATED).json(response);
      },

      Err: (err: string) => this.sendError(res, err),
    });
  }

  @Throttle({
    default: { limit: REFRESH_THROTTLE_LIMIT, ttl: REFRESH_THROTTLE_TTL },
  })
  @Post('refresh')
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Làm mới phiên đăng nhập',
    description:
      'Đổi refresh_token trong cookie lấy cặp token mới. Khi thất bại, ' +
      '`data.retryable` cho biết client nên thử lại hay phải đăng nhập lại.',
  })
  @ApiOkResponse({ description: 'Làm mới thành công', type: AuthSessionResponse })
  @ApiUnauthorizedResponse({
    description: 'Refresh token không hợp lệ, hết hạn hoặc đã bị dùng lại',
    type: RefreshFailureResponse,
  })
  @ApiTooManyRequestsResponse({ description: THROTTLE_ERROR_MESSAGE })
  async refresh(
    @Req() req: RequestWithCookies,
    @Res() res: Response,
  ): Promise<void> {
    const result: Result<IAuthSession, IRefreshFailure> =
      await this.authService.refresh(req.cookies?.[REFRESH_COOKIE]);

    return match(result, {
      Ok: (session: IAuthSession) => {
        setAuthCookies(res, session, this.isProd);

        const response: AuthSessionResponse = {
          statusCode: HttpStatus.OK,
          message: 'Làm mới phiên thành công',
          data: this.toSessionData(session),
        };

        res.status(HttpStatus.OK).json(response);
      },

      Err: (failure: IRefreshFailure) => {
        /*
         * `clearCookies` is obeyed, never inferred. On the grace branch it is
         * false: that response is the loser of a rotation race and lands *after*
         * the winner has already set a fresh refresh_token, so clearing here
         * would delete the winner's new cookie and sign out a user whose
         * refresh had just succeeded.
         */
        if (failure.clearCookies) clearAuthCookies(res, this.isProd);

        // A SYSTEM failure is about the server, not the token. Reporting it as
        // 401 would hide infrastructure faults inside the auth-failure count.
        const status =
          failure.kind === 'SYSTEM'
            ? HttpStatus.INTERNAL_SERVER_ERROR
            : HttpStatus.UNAUTHORIZED;

        const response: RefreshFailureResponse = {
          statusCode: status,
          message: failure.message,
          data: { retryable: failure.retryable },
        };

        res.status(status).json(response);
      },
    });
  }

  @Post('logout')
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Đăng xuất',
    description:
      'Thu hồi family của refresh token đang gửi lên và xoá cả hai cookie. ' +
      'Idempotent: thiếu cookie hoặc cookie rác vẫn trả 200. Lưu ý access ' +
      'token đã phát hành vẫn còn hiệu lực tới hết hạn của nó.',
  })
  @ApiOkResponse({ description: 'Đăng xuất thành công', type: LogoutResponse })
  async logout(
    @Req() req: RequestWithCookies,
    @Res() res: Response,
  ): Promise<void> {
    const result: Result<boolean, string> = await this.authService.logout(
      req.cookies?.[REFRESH_COOKIE],
    );

    return match(result, {
      Ok: () => {
        // Mirrors setAuthCookies attribute for attribute, which is what makes
        // the deletion actually take effect for the /api/auth-scoped cookie.
        clearAuthCookies(res, this.isProd);

        const response: LogoutResponse = {
          statusCode: HttpStatus.OK,
          message: 'Đăng xuất thành công',
          data: { success: true },
        };

        res.status(HttpStatus.OK).json(response);
      },

      Err: (err: string) => {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: err,
        });
      },
    });
  }

  /*
   * Deliberately NOT throttled: the frontend hits this on every page load, so a
   * per-route budget here would turn ordinary browsing into 429s.
   *
   * AtGuard is the permissive guard, so a guest gets a clean 200 rather than a
   * 401 in the console on every anonymous page view.
   */
  @UseGuards(AtGuard)
  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Thông tin phiên hiện tại',
    description:
      'Trả về 200 cho cả khách và người đã đăng nhập. Khách nhận ' +
      '`{ user: null, accessTokenExpiresAt: null }` — `data` không bao giờ null.',
  })
  @ApiOkResponse({ description: 'Trạng thái phiên hiện tại', type: MeResponse })
  async me(
    @GetCurrentUser() authUser: IAuthUser | null,
    @Res() res: Response,
  ): Promise<void> {
    const guest: MeResponse = {
      statusCode: HttpStatus.OK,
      message: 'Chưa đăng nhập',
      // An object, never a bare null: the frontend's apiFetch throws on a null
      // `data`, which would make every anonymous page load look like an error.
      data: { user: null, accessTokenExpiresAt: null },
    };

    if (!authUser) {
      res.status(HttpStatus.OK).json(guest);
      return;
    }

    /*
     * Read the row rather than trust the token. `name` and `createdAt` are not
     * claims at all, and reading the rest live means a rename or a role change
     * shows up here immediately instead of at the next rotation.
     */
    const result = await this.authService.getProfile(authUser.userId);

    if (result.isErr()) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: result.unwrapErr(),
      });
      return;
    }

    const user = result.unwrap();

    // A valid token for a user who no longer exists: treat as a guest rather
    // than a 500. The token will fail to refresh anyway, since deleting the
    // user cascades their whole token family away.
    if (!user) {
      res.status(HttpStatus.OK).json(guest);
      return;
    }

    const response: MeResponse = {
      statusCode: HttpStatus.OK,
      message: 'Lấy thông tin phiên thành công',
      data: {
        user: this.mapToUserData(user),
        // `exp` is seconds; this field is milliseconds. Hence the name.
        accessTokenExpiresAt: authUser.exp ? authUser.exp * 1_000 : null,
      },
    };

    res.status(HttpStatus.OK).json(response);
  }
}
