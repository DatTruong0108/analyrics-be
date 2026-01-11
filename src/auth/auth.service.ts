/* eslint-disable @typescript-eslint/no-unused-vars */
/* System Package */
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Result, Ok, Err } from 'oxide.ts';
import { hash, compare } from 'bcryptjs';

/* Application Package */
import { IAuthRepository } from './repositories/auth.repository';
import { ILoginResult, IUser } from './interfaces/auth.interface';
import { IJwtPayload } from './interfaces/jwt.interface';
import { LoginDto, RegisterDto } from './auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: IAuthRepository,
    private readonly jwtService: JwtService,
  ) { }

  async register(dto: RegisterDto): Promise<Result<IUser, string>> {
    const existingRes = await this.authRepository.findByEmail(dto.email);
    if (existingRes.isErr()) return Err(existingRes.unwrapErr());

    if (existingRes.unwrap()) return Err('Email đã tồn tại trong hệ thống.');

    const hashedPass = await hash(dto.password, 10);
    return this.authRepository.createUser(dto, hashedPass);
  }

  async login(dto: LoginDto): Promise<Result<ILoginResult, string>> {
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

      const payload: IJwtPayload = { sub: user.id, email: user.email, role: user.role };
      const accessToken = this.jwtService.sign(payload);

      return Ok({ user, accessToken });
    } catch (error) {
      return Err('Đăng nhập thất bại. Hệ thống bị lỗi, vui lòng thử lại sau.');
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async logout(): Promise<Result<boolean, string>> {
    try {
      // Sau này có thể thêm logic xóa Refresh Token trong DB tại đây (nếu có)
      return Ok(true);
    } catch (error) {
      return Err('Hệ thống bị lỗi vui lòng thử lại sau.');
    }
  }
}