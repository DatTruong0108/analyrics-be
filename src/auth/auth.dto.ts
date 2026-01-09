/* System Package */
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

/* Application Package */
import { BaseResponse } from 'src/shared/constants/baseResponse';

export class UserData {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'Hieu Thu Hai' })
  name: string;

  @ApiProperty({ example: 'hieuthuhai@example.com' })
  email: string;

  @ApiProperty({ example: 'USER' })
  role: string;

  @ApiProperty()
  created_at: Date;
}

export class UserResponse extends BaseResponse {
  @ApiProperty({ type: UserData, description: 'User data' })
  data: UserData;
}

export class RegisterDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  password: string;
}

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsNotEmpty()
  password: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;
}