import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { BaseResponse } from 'src/shared/constants/baseResponse';

export class UserData {
  @ApiProperty({ example: '60ca2f2b-7430-474a-b0d8-...', description: 'ID duy nhất của người dùng' })
  id: string;

  @ApiProperty({ example: 'Nguyễn Văn Đạt', description: 'Tên hiển thị' })
  name: string;

  @ApiProperty({ example: 'dat@example.com', description: 'Email dùng để đăng nhập' })
  email: string;

  @ApiProperty({ example: 'USER', description: 'Vai trò trong hệ thống' })
  role: string;

  @ApiProperty({ example: '2026-01-13T12:00:00Z', description: 'Ngày tạo tài khoản' })
  created_at: Date;
}

export class LoginDto {
  @ApiProperty({ example: 'dat@example.com', description: 'Email tài khoản' })
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  @IsNotEmpty({ message: 'Email không được để trống' })
  email: string;

  @ApiProperty({ example: 'Password123!', description: 'Mật khẩu bảo mật' })
  @IsString()
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  password: string;
}

export class RegisterDto extends LoginDto {
  @ApiProperty({ example: 'Nguyễn Văn Đạt', description: 'Họ và tên đầy đủ' })
  @IsString()
  @IsNotEmpty({ message: 'Tên không được để trống' })
  name: string;

  @ApiPropertyOptional({ example: '0901234567', description: 'Số điện thoại (không bắt buộc)' })
  @IsOptional()
  @IsString()
  phone?: string;
}

export class UserResponse extends BaseResponse {
  @ApiProperty({ type: UserData })
  data: UserData;
}