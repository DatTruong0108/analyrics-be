import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { BaseResponse } from 'src/shared/constants/baseResponse';

export class UserData {
  @ApiProperty({ example: '60ca2f2b-7430-474a-b0d8-...', description: 'ID duy nhất của người dùng' })
  id!: string;

  @ApiProperty({ example: 'Nguyễn Văn Đạt', description: 'Tên hiển thị' })
  name!: string;

  @ApiProperty({ example: 'dat@example.com', description: 'Email dùng để đăng nhập' })
  email!: string;

  @ApiProperty({ example: 'USER', description: 'Vai trò trong hệ thống' })
  role!: string;

  @ApiProperty({ example: '2026-01-13T12:00:00Z', description: 'Ngày tạo tài khoản' })
  created_at!: Date;
}

export class LoginDto {
  @ApiProperty({ example: 'dat@example.com', description: 'Email tài khoản' })
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  @IsNotEmpty({ message: 'Email không được để trống' })
  email!: string;

  @ApiProperty({ example: 'Password123!', description: 'Mật khẩu bảo mật' })
  @IsString()
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  password!: string;
}

export class RegisterDto extends LoginDto {
  @ApiProperty({ example: 'Nguyễn Văn Đạt', description: 'Họ và tên đầy đủ' })
  @IsString()
  @IsNotEmpty({ message: 'Tên không được để trống' })
  name!: string;

  @ApiPropertyOptional({ example: '0901234567', description: 'Số điện thoại (không bắt buộc)' })
  @IsOptional()
  @IsString()
  phone?: string;
}

export class UserResponse extends BaseResponse {
  @ApiProperty({ type: UserData })
  data!: UserData;
}

/**
 * Payload for login, register and refresh.
 *
 * `accessTokenExpiresAt` is an **absolute epoch milliseconds** value, not a
 * duration: a duration goes stale the instant the client caches it. The `At`
 * suffix is load-bearing — the JWT's own `exp` is in *seconds* while
 * `Date.now()` is in milliseconds, so a field named for its unit is what stops
 * the guaranteed x1000 mistake.
 */
export class AuthSessionData {
  @ApiProperty({ type: UserData })
  user!: UserData;

  @ApiProperty({
    example: 1788170007000,
    description: 'Epoch milliseconds tại đó access token hết hạn',
  })
  accessTokenExpiresAt!: number;
}

export class AuthSessionResponse extends BaseResponse {
  @ApiProperty({ type: AuthSessionData })
  data!: AuthSessionData;
}

/**
 * Payload for `GET /auth/me`.
 *
 * Both fields are nullable, but `data` itself never is: a guest gets
 * `{ user: null, accessTokenExpiresAt: null }`. The frontend's `apiFetch`
 * throws on a null `data`, so returning a bare null here would make every
 * anonymous page load an error instead of an ordinary guest response.
 */
export class MeData {
  @ApiProperty({ type: UserData, nullable: true })
  user!: UserData | null;

  @ApiProperty({
    example: 1788170007000,
    nullable: true,
    description: 'null khi chưa đăng nhập',
  })
  accessTokenExpiresAt!: number | null;
}

export class MeResponse extends BaseResponse {
  @ApiProperty({ type: MeData })
  data!: MeData;
}

/** Logout carries a non-null `data` for the same `apiFetch` reason as above. */
export class LogoutData {
  @ApiProperty({ example: true })
  success!: boolean;
}

export class LogoutResponse extends BaseResponse {
  @ApiProperty({ type: LogoutData })
  data!: LogoutData;
}

/**
 * Failure body for `POST /auth/refresh`.
 *
 * Carries `data.retryable` on top of the usual error shape so the client can
 * tell "you lost a rotation race, try again" apart from "you are signed out".
 * Without that distinction a benign multi-tab race routes the user to the
 * sign-in screen.
 */
export class RefreshFailureData {
  @ApiProperty({
    example: true,
    description: 'true khi client nên thử lại thay vì đăng nhập lại',
  })
  retryable!: boolean;
}

export class RefreshFailureResponse extends BaseResponse {
  @ApiProperty({ type: RefreshFailureData })
  data!: RefreshFailureData;
}