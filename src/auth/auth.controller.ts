/* System Package */
import { Controller, Post, Body, Res, Req, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Result, match } from 'oxide.ts';

/* Application Package */
import { AuthService } from './auth.service';
import { UserResponse, LoginDto, RegisterDto, UserData } from './auth.dto';
import { IUser, IAuthSession } from './interfaces/auth.interface';
import { BaseResponse } from 'src/shared/constants/baseResponse';
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  setAuthCookies,
} from './utils/auth-cookies.util';

/** Narrows the `any`-typed bag cookie-parser attaches to the request. */
interface RequestWithCookies extends Request {
  cookies: Record<string, string | undefined>;
}

@Controller('/auth')
@ApiTags('Auth')
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

  @Post('login')
  @ApiOperation({
    summary: 'User login',
    description: 'Authenticate user and return JWT token'
  })
  @ApiOkResponse({
    description: 'Login successful',
    type: UserResponse
  })
  @ApiBadRequestResponse({
    description: 'Bad request - Invalid credentials'
  })
  async login(
    @Body() dto: LoginDto,
    @Res() res: Response
  ): Promise<void> {
    const result: Result<IAuthSession, string> = await this.authService.login(dto);

    return match(result, {
      Ok: (session: IAuthSession) => {
        // Both cookies, one source of truth for their attributes — the refresh
        // cookie is scoped to /api/auth, the access cookie site-wide.
        setAuthCookies(res, session, this.isProd);

        const response: UserResponse = {
          statusCode: HttpStatus.OK,
          message: 'Đăng nhập thành công',
          data: this.mapToUserData(session.user),
        };

        res.status(HttpStatus.OK).json(response);
      },

      Err: (err: string) => {
        const isSystem = err.includes('Hệ thống');
        const status = isSystem ? HttpStatus.INTERNAL_SERVER_ERROR : HttpStatus.BAD_REQUEST;

        res.status(status).json({
          statusCode: status,
          message: err,
        });
      },
    });
  }

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res() res: Response,
  ): Promise<void> {
    const result: Result<IAuthSession, string> = await this.authService.register(dto);

    return match(result, {
      Ok: (session: IAuthSession) => {
        // Register signs the user in, so it sets the same cookies login does.
        // The response body contract is unchanged.
        setAuthCookies(res, session, this.isProd);

        const response: UserResponse = {
          statusCode: HttpStatus.CREATED,
          message: 'Đăng ký tài khoản thành công',
          data: this.mapToUserData(session.user),
        };

        res.status(HttpStatus.CREATED).json(response);
      },

      Err: (err: string) => {
        const isSystem = err.includes('Hệ thống');
        const status = isSystem ? HttpStatus.INTERNAL_SERVER_ERROR : HttpStatus.BAD_REQUEST;

        res.status(status).json({
          statusCode: status,
          message: err,
        });
      },
    });
  }

  @Post('logout')
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

        const response: BaseResponse = {
          statusCode: HttpStatus.OK,
          message: 'Đăng xuất thành công',
        };

        res.status(HttpStatus.OK).json(response);
      },

      Err: (err: string) => {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: err,
        });
      }
    })
  }
}
