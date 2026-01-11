/* System Package */
import { Controller, Post, Body, Res, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Result, match } from 'oxide.ts';

/* Application Package */
import { AuthService } from './auth.service';
import { UserResponse, LoginDto, RegisterDto, UserData } from './auth.dto';
import { IUser, ILoginResult } from './interfaces/auth.interface';
import { BaseResponse } from 'src/shared/constants/baseResponse';

@Controller('/api/auth')
@ApiTags('Auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  private mapToUserData(user: IUser): UserData {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      created_at: user.createdAt,
    };
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
    const result: Result<ILoginResult, string> = await this.authService.login(dto);

    // 2. Sử dụng hàm match (standalone function) thay vì method
    return match(result, {
      // 3. Destructure đúng ILoginResult: { user, accessToken }
      Ok: ({ user, accessToken }: ILoginResult) => {
        res.cookie('access_token', accessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        const response: UserResponse = {
          statusCode: HttpStatus.OK,
          message: 'Đăng nhập thành công',
          // Lúc này user đã có kiểu IUser, không còn là 'any'
          data: this.mapToUserData(user),
        };

        res.status(HttpStatus.OK).json(response);
      },

      // 4. Khai báo kiểu string cho err để xóa lỗi "Unsafe assignment"
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
    // Gọi service và nhận kết quả dạng Result
    const result: Result<IUser, string> = await this.authService.register(dto);

    // Sử dụng match để xử lý tường minh 2 trường hợp thành công và thất bại
    return match(result, {
      Ok: (user: IUser) => {
        const response: UserResponse = {
          statusCode: HttpStatus.CREATED,
          message: 'Đăng ký tài khoản thành công',
          data: this.mapToUserData(user),
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
  async logout(@Res() res: Response): Promise<void> {
    const result: Result<boolean, string> = await this.authService.logout();

    return match(result, {
      Ok: () => {
        res.clearCookie('access_token', {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
        });

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
